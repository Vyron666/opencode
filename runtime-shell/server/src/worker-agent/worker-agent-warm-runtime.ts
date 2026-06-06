import { AcpProcessClient } from "../acp/acp-process-client"
import { Config } from "../config"
import { createLogger } from "../log"
import { computeRuntimeConfigFingerprint } from "../runtime/runtime-config-content"
import { attachDockerSandboxAcp } from "./sandbox/docker-sandbox-acp"
import {
  destroyWarmPoolSlot,
  getLeasedWarmPoolSlot,
  getWarmPoolSlotById,
  prepareWarmPoolWorkspace,
  readWarmPool,
  reserveWarmPoolSlot,
  releaseWarmPoolSlot,
  setWarmPoolReleaseObserver,
  takeWarmPoolSlot,
} from "./sandbox/docker-sandbox-warm-pool"
import { runAcpBootstrapGate } from "./sandbox/docker-sandbox-cold-start"
import { WARM_POOL_RUNTIME_CWD, type WarmPoolSlot } from "./sandbox/docker-sandbox-state"
import type { SandboxHandle } from "./sandbox/sandbox-types"
import { createBoundRuntimeEntryFromClient } from "./worker-agent-runtime-support"

const log = createLogger("worker-agent-warm-runtime")
const pendingWarmRuntimeBySession = new Map<string, Promise<void>>()
const pendingWarmRuntimeBackfillByWorker = new Map<string, Promise<void>>()
const WARM_RUNTIME_PREWARM_GRACE_MS = 3_000
const WARM_RUNTIME_OPEN_BACKFILL_GRACE_MS = 2_000
const WARM_RUNTIME_STEP_TIMEOUT_MS = Math.max(1_000, Config.workerAgentRequestTimeoutMs - 1_000)
const GENERIC_WARM_SLOT_RESERVE = 1
const WARM_RUNTIME_DEMAND_TTL_MS = 30 * 60 * 1000
const warmRuntimeDemandByWorker = new Map<string, Map<string, {
  configContent?: string
  hitCount: number
  lastUsedAt: number
}>>()

setWarmPoolReleaseObserver((workerId) => {
  void backfillReadyWarmRuntimeSlots(workerId).catch(() => {})
})

type WarmRuntimeRequest = {
  runtimeShellBaseUrl: string
  workerToken: string
  businessSessionId: string
  workspaceId: string
  workspacePath: string
  sandboxPath: string
  workerId: string
  configContent?: string
  warmPoolTarget?: number
}

export async function prewarmSessionRuntimeOnWorker(input: WarmRuntimeRequest) {
  rememberWarmRuntimeDemand(
    input.workerId,
    computeRuntimeConfigFingerprint(input.configContent),
    input.configContent,
  )
  const pending = pendingWarmRuntimeBySession.get(input.businessSessionId)
  if (pending) return pending
  const task = doPrewarmSessionRuntime(input)
  pendingWarmRuntimeBySession.set(input.businessSessionId, task)
  try {
    return await task
  } finally {
    if (pendingWarmRuntimeBySession.get(input.businessSessionId) === task) {
      pendingWarmRuntimeBySession.delete(input.businessSessionId)
    }
  }
}

export async function waitForWarmRuntimePrewarm(businessSessionId: string) {
  const pending = pendingWarmRuntimeBySession.get(businessSessionId)
  if (!pending) return
  await Promise.race([
    pending.catch(() => {}),
    Bun.sleep(WARM_RUNTIME_PREWARM_GRACE_MS),
  ])
}

export async function backfillReadyWarmRuntimeSlots(workerId: string) {
  const pending = pendingWarmRuntimeBackfillByWorker.get(workerId)
  if (pending) return pending
  const task = doBackfillReadyWarmRuntimeSlots(workerId)
  pendingWarmRuntimeBackfillByWorker.set(workerId, task)
  try {
    await task
  } finally {
    if (pendingWarmRuntimeBackfillByWorker.get(workerId) === task) {
      pendingWarmRuntimeBackfillByWorker.delete(workerId)
    }
  }
}

export async function tryOpenWarmRuntimeEntry(input: WarmRuntimeRequest) {
  await waitForWarmRuntimePrewarm(input.businessSessionId)
  const configFingerprint = computeRuntimeConfigFingerprint(input.configContent)
  rememberWarmRuntimeDemand(input.workerId, configFingerprint, input.configContent)
  const staleLease = getLeasedWarmPoolSlot({
    workerId: input.workerId,
    businessSessionId: input.businessSessionId,
    workspaceId: input.workspaceId,
  })
  if (staleLease && staleLease.configFingerprint !== configFingerprint) {
    // 中文/English: if the visible provider/MCP/skill config changed between
    // prewarm and open, the old warm runtime must be discarded instead of reused.
    await destroyWarmPoolSlot(staleLease).catch(() => {})
  }
  if (!hasReadyWarmRuntimeSlot(input.workerId, configFingerprint)) {
    await Promise.race([
      backfillReadyWarmRuntimeSlots(input.workerId).catch(() => {}),
      Bun.sleep(WARM_RUNTIME_OPEN_BACKFILL_GRACE_MS),
    ])
  }
  const slot = takeWarmPoolSlot(
    input.workerId,
    input.businessSessionId,
    input.workspaceId,
    configFingerprint,
  )
  if (!slot) return
  const { handle, client } = await ensureWarmRuntimeSlotReady(slot, input)
  return createBoundRuntimeEntryFromClient({
    runtimeShellBaseUrl: input.runtimeShellBaseUrl,
    workerToken: input.workerToken,
    businessSessionId: input.businessSessionId,
    workspaceId: input.workspaceId,
    workspacePath: input.workspacePath,
    sandboxPath: input.sandboxPath,
    workerId: input.workerId,
    client,
    sandboxHandle: handle,
    closeSandbox: () => releaseWarmPoolSlot(handle),
    releaseRuntime: () => releaseWarmRuntimeSession(client, handle),
    runtimeCwd: WARM_POOL_RUNTIME_CWD,
    configContent: input.configContent,
  })
}

async function releaseWarmRuntimeSession(client: AcpProcessClient, handle: SandboxHandle) {
  try {
    await client.closeActiveSession()
    // 中文/English: drain close-session side effects before returning the long-lived
    // runtime to the pool, otherwise late events can leak into the next lease.
    await client.flushPendingEvents()
  } catch (error) {
    handle.invalidPoolSlot = true
    throw error
  }
}

async function doPrewarmSessionRuntime(input: WarmRuntimeRequest) {
  const configFingerprint = computeRuntimeConfigFingerprint(input.configContent)
  const reservedSlot = await reserveWarmPoolSlot({
    workerId: input.workerId,
    businessSessionId: input.businessSessionId,
    workspaceId: input.workspaceId,
    configFingerprint,
    warmPoolTarget: input.warmPoolTarget,
  })
  if (!reservedSlot) {
    // 中文/English: if no ready slot is available, only backfill worker-local warm
    // capacity; do not create an extra per-session runtime outside the pool budget.
    await backfillReadyWarmRuntimeSlots(input.workerId)
    return
  }
  try {
    await withWarmRuntimeStepTimeout(
      reservedSlot,
      "warm runtime prewarm timed out",
      async () => {
        await runAcpBootstrapGate(() => ensureWarmRuntimeClient(reservedSlot, {
          businessSessionId: input.businessSessionId,
          workspaceId: input.workspaceId,
          workerId: input.workerId,
          configContent: input.configContent,
          warmSessionBootstrap: true,
        }))
        log.info("session warm runtime prewarmed", {
          workerId: input.workerId,
          slotId: reservedSlot.id,
          businessSessionId: input.businessSessionId,
          configFingerprint,
        })
      },
    )
    void backfillReadyWarmRuntimeSlots(input.workerId).catch(() => {})
  } catch (error) {
    await destroyWarmPoolSlot(reservedSlot).catch(() => {})
    void backfillReadyWarmRuntimeSlots(input.workerId).catch(() => {})
    throw error
  }
}

async function ensureWarmRuntimeClient(slot: WarmPoolSlot, input: {
  businessSessionId: string
  workspaceId: string
  workerId: string
  configContent?: string
  warmSessionBootstrap?: boolean
}) {
  if (slot.runtimeClient) return slot.runtimeClient
  if (slot.runtimeClientPromise) return slot.runtimeClientPromise
  const handle = createWarmRuntimeClientHandle(slot, input)
  const task = (async () => {
    const client = new AcpProcessClient(
      {
        cwd: WARM_POOL_RUNTIME_CWD,
        businessSessionId: input.businessSessionId,
        workerId: input.workerId,
        configContent: input.configContent,
        onEvent: async () => {
          // 中文/English: warm runtime prewarm keeps the process hot without
          // binding business-session event delivery until a real open/load happens.
        },
      },
      () => Promise.resolve(),
      (options) =>
        attachDockerSandboxAcp({
          handle,
          runtimeClientOptions: options,
        }),
    )
    slot.preparingRuntime = true
    try {
      await client.initialize()
      if (input.warmSessionBootstrap) {
        await warmMaterializedRuntimeClient(slot, client)
      }
    } catch (error) {
      client.terminate("warm runtime initialize failed")
      throw error
    } finally {
      slot.preparingRuntime = false
    }
    if (getWarmPoolSlotById(slot.id) !== slot) {
      client.terminate("warm runtime slot was released during initialize")
      throw new Error(`warm runtime slot is no longer tracked: ${slot.id}`)
    }
    slot.runtimeClient = client
    client.onExit(() => {
      if (getWarmPoolSlotById(slot.id)?.runtimeClient !== client) return
      slot.runtimeClient = undefined
      slot.runtimeClientPromise = undefined
      void destroyWarmPoolSlot(slot).catch(() => {})
    })
    return client
  })()
  slot.runtimeClientPromise = task
  try {
    return await task
  } finally {
    if (slot.runtimeClientPromise === task && !slot.runtimeClient) {
      slot.runtimeClientPromise = undefined
    }
  }
}

async function doBackfillReadyWarmRuntimeSlots(workerId: string) {
  const warmRuntimeBuckets = listWarmRuntimeBuckets(workerId)
  if (!warmRuntimeBuckets.length) return
  const slots = readWarmPool(workerId)
  const genericSlots = slots.filter((slot) =>
    slot.ready
    && !slot.leased
    && !slot.preparingRuntime
    && !slot.runtimeClient
    && !slot.runtimeClientPromise
    && !slot.configFingerprint,
  )
  const hasReadyMaterializedSlot = warmRuntimeBuckets.some((bucket) =>
    slots.some((slot) =>
      slot.ready
      && !slot.leased
      && !slot.preparingRuntime
      && slot.runtimeClient
      && slot.configFingerprint === bucket.configFingerprint,
    ),
  )
  const genericReserve = warmRuntimeBuckets.length > 1 || !hasReadyMaterializedSlot
    ? GENERIC_WARM_SLOT_RESERVE
    : 0
  const materializableSlots = genericSlots.slice(0, Math.max(0, genericSlots.length - genericReserve))
  if (!materializableSlots.length) return
  await Promise.all(materializableSlots.map((slot, index) => {
    const bucket = warmRuntimeBuckets[index % warmRuntimeBuckets.length]
    if (!bucket) return Promise.resolve()
    // 中文/English: materialize multiple warm runtimes in parallel so a single
    // worker can consume its whole warm budget before concurrent open arrives.
    return materializeWarmRuntimeSlot(slot, bucket).catch(() => {})
  }))
}

async function materializeWarmRuntimeSlot(
  slot: WarmPoolSlot,
  bucket: {
    configFingerprint: string
    configContent?: string
  },
) {
  if (slot.runtimeClient || slot.runtimeClientPromise || slot.preparingRuntime || slot.leased) return
  slot.configFingerprint = bucket.configFingerprint
  try {
    await runAcpBootstrapGate(() => ensureWarmRuntimeClient(slot, {
      businessSessionId: `warm_pool_${slot.id}`,
      workspaceId: `warm_pool_${slot.id}`,
      workerId: slot.workerId,
      configContent: bucket.configContent,
      warmSessionBootstrap: true,
    }))
    log.info("warm runtime materialized", {
      workerId: slot.workerId,
      slotId: slot.id,
      configFingerprint: slot.configFingerprint,
    })
  } catch (error) {
    log.warn("warm runtime materialize failed", {
      workerId: slot.workerId,
      slotId: slot.id,
      configFingerprint: bucket.configFingerprint,
      message: error instanceof Error ? error.message : String(error),
    })
    await destroyWarmPoolSlot(slot).catch(() => {})
    throw error
  }
}

async function warmMaterializedRuntimeClient(slot: WarmPoolSlot, client: AcpProcessClient) {
  if (slot.leased) return
  // 中文/English: pre-open one short-lived ACP session in the background so the
  // first real user lease does not pay plugin/provider/skill bootstrap again.
  slot.preparingRuntime = true
  try {
    await client.newSession(WARM_POOL_RUNTIME_CWD)
  } finally {
    try {
      await client.closeActiveSession()
      await client.flushPendingEvents()
    } finally {
      slot.preparingRuntime = false
    }
  }
}

async function ensureWarmRuntimeSlotReady(slot: WarmPoolSlot, input: WarmRuntimeRequest) {
  const handle = toWarmSandboxHandle(slot, input)
  try {
    const client = await withWarmRuntimeStepTimeout(
      slot,
      "warm runtime open timed out",
      async () => {
        await prepareWarmPoolWorkspace(handle)
        return ensureWarmRuntimeClient(slot, input)
      },
    )
    return {
      handle,
      client,
    }
  } catch (error) {
    await destroyWarmPoolSlot(slot).catch(() => {})
    throw error
  }
}

function createWarmRuntimeClientHandle(
  slot: WarmPoolSlot,
  input: {
    businessSessionId: string
    workspaceId: string
    workerId: string
  },
) {
  return toWarmSandboxHandle(slot, {
    businessSessionId: input.businessSessionId,
    workspaceId: input.workspaceId,
    workerId: input.workerId,
    workspacePath: slot.visiblePath,
  })
}

function toWarmSandboxHandle(
  slot: WarmPoolSlot,
  input: Pick<WarmRuntimeRequest, "businessSessionId" | "workspaceId" | "workerId" | "workspacePath"> & {
    sandboxPath?: string
  },
): SandboxHandle {
  return {
    workerId: input.workerId,
    businessSessionId: input.businessSessionId,
    workspaceId: input.workspaceId,
    containerName: slot.containerName,
    workspacePath: slot.visiblePath,
    sandboxPath: input.sandboxPath,
    runtimeCwd: WARM_POOL_RUNTIME_CWD,
    runtimeHomePath: slot.runtimeHomePath,
    poolSlotId: slot.id,
  }
}

function rememberWarmRuntimeDemand(workerId: string, configFingerprint: string, configContent?: string) {
  const now = Date.now()
  const buckets = warmRuntimeDemandByWorker.get(workerId) || new Map<string, {
    configContent?: string
    hitCount: number
    lastUsedAt: number
  }>()
  buckets.set(configFingerprint, {
    configContent,
    hitCount: (buckets.get(configFingerprint)?.hitCount ?? 0) + 1,
    lastUsedAt: now,
  })
  for (const [fingerprint, bucket] of buckets.entries()) {
    if (now - bucket.lastUsedAt <= WARM_RUNTIME_DEMAND_TTL_MS) continue
    buckets.delete(fingerprint)
  }
  warmRuntimeDemandByWorker.set(workerId, buckets)
}

function listWarmRuntimeBuckets(workerId: string) {
  return [...(warmRuntimeDemandByWorker.get(workerId)?.entries() || [])]
    .map(([configFingerprint, bucket]) => ({
      configFingerprint,
      configContent: bucket.configContent,
      hitCount: bucket.hitCount,
      lastUsedAt: bucket.lastUsedAt,
    }))
    .sort((left, right) =>
      right.hitCount - left.hitCount || right.lastUsedAt - left.lastUsedAt,
    )
}

function hasReadyWarmRuntimeSlot(workerId: string, configFingerprint: string) {
  return readWarmPool(workerId).some((slot) =>
    slot.ready &&
    !slot.leased &&
    !slot.preparingRuntime &&
    Boolean(slot.runtimeClient) &&
    slot.configFingerprint === configFingerprint,
  )
}

async function withWarmRuntimeStepTimeout<T>(
  slot: WarmPoolSlot,
  label: string,
  taskFactory: () => Promise<T>,
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      taskFactory(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`${label} after ${WARM_RUNTIME_STEP_TIMEOUT_MS}ms: ${slot.id}`)
          error.name = "WarmRuntimeTimeoutError"
          reject(error)
        }, WARM_RUNTIME_STEP_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
