import { AcpProcessClient } from "../acp/acp-process-client"
import { Config } from "../config"
import { createLogger } from "../log"
import { computeRuntimeConfigFingerprint } from "../runtime/runtime-config-content"
import { attachDockerSandboxAcp } from "./sandbox/docker-sandbox-acp"
import {
  countReadyGenericWarmPoolSlots,
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
import {
  WARM_POOL_RUNTIME_CWD,
  isWorkerAgentShuttingDown,
  warmPoolTargetByWorker,
  runWithWarmRuntimeMaterializeGate,
  type WarmPoolSlot,
} from "./sandbox/docker-sandbox-state"
import type { SandboxHandle } from "./sandbox/sandbox-types"
import { createBoundRuntimeEntryFromClient } from "./worker-agent-runtime-support"

const log = createLogger("worker-agent-warm-runtime")
const pendingWarmRuntimeBySession = new Map<string, Promise<void>>()
const pendingWarmRuntimeBackfillByWorker = new Map<string, Promise<void>>()
const WARM_RUNTIME_OPEN_BACKFILL_GRACE_MS = 2_000
const WARM_RUNTIME_STEP_TIMEOUT_MS = Math.max(1_000, Config.workerAgentRequestTimeoutMs - 1_000)
const GENERIC_WARM_SLOT_RESERVE = 1
const WARM_RUNTIME_DEMAND_TTL_MS = 30 * 60 * 1000
const WARM_RUNTIME_IDLE_COOLDOWN_MS = 5 * 60 * 1000
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
  if (isWorkerAgentShuttingDown()) return
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
  await pendingWarmRuntimeBySession.get(businessSessionId)?.catch(() => {})
}

export async function backfillReadyWarmRuntimeSlots(workerId: string) {
  if (isWorkerAgentShuttingDown()) return
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
  if (isWorkerAgentShuttingDown()) return
  await waitForWarmRuntimePrewarm(input.businessSessionId)
  const configFingerprint = computeRuntimeConfigFingerprint(input.configContent)
  rememberWarmRuntimeDemand(input.workerId, configFingerprint, input.configContent)
  const staleLease = getLeasedWarmPoolSlot({
    workerId: input.workerId,
    businessSessionId: input.businessSessionId,
    workspaceId: input.workspaceId,
  })
  if (staleLease && staleLease.configFingerprint !== configFingerprint) {
    // 中文/English: config changed between prewarm and open, so the old warm runtime
    // must be discarded instead of crossing provider/MCP/skill boundaries.
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
    // 中文/English: drain close-session side effects before returning the runtime
    // to the pool, otherwise late events can leak into the next lease.
    await client.flushPendingEvents()
  } catch (error) {
    handle.invalidPoolSlot = true
    throw error
  }
}

async function doPrewarmSessionRuntime(input: WarmRuntimeRequest) {
  if (isWorkerAgentShuttingDown()) return
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
        await prepareWarmPoolWorkspace(toWarmSandboxHandle(reservedSlot, input))
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
  if (isWorkerAgentShuttingDown()) {
    throw new Error("worker agent is shutting down")
  }
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
          // 中文/English: prewarm keeps the ACP process hot without binding event
          // delivery until a real business session leases the runtime.
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
  if (isWorkerAgentShuttingDown()) return
  const warmRuntimeBuckets = listWarmRuntimeBuckets(workerId)
  const target = Math.max(0, warmPoolTargetByWorker.get(workerId) ?? 0)
  const desiredReadyWarmRuntimeCount = readDesiredReadyWarmRuntimeCount(target, warmRuntimeBuckets)
  await coolDownExtraWarmRuntimeSlots(workerId, desiredReadyWarmRuntimeCount)
  if (!warmRuntimeBuckets.length) return
  while (!isWorkerAgentShuttingDown() && countReadyWarmRuntimeSlots(workerId) < desiredReadyWarmRuntimeCount) {
    const slots = readWarmPool(workerId)
    const slot = selectGenericWarmSlotForMaterialize(slots, warmRuntimeBuckets, target)
    if (!slot) return
    const bucket = selectWarmRuntimeBucketForMaterialize(slots, warmRuntimeBuckets)
    if (!bucket) return
    await materializeWarmRuntimeSlot(slot, bucket).catch(() => {})
  }
}

async function materializeWarmRuntimeSlot(
  slot: WarmPoolSlot,
  bucket: {
    configFingerprint: string
    configContent?: string
    lastUsedAt?: number
  },
) {
  if (isWorkerAgentShuttingDown()) return
  if (slot.runtimeClient || slot.runtimeClientPromise || slot.preparingRuntime || slot.leased) return
  await runWithWarmRuntimeMaterializeGate(async () => {
    if (isWorkerAgentShuttingDown()) return
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
  })
}

async function coolDownExtraWarmRuntimeSlots(workerId: string, desiredReadyWarmRuntimeCount: number) {
  const idleMaterializedSlots = readWarmPool(workerId).filter((slot) =>
    slot.ready &&
    !slot.leased &&
    !slot.preparingRuntime &&
    Boolean(slot.runtimeClient),
  )
  const activeFingerprints = new Set(
    listWarmRuntimeBuckets(workerId)
      .filter((bucket) => isWarmRuntimeBucketRecentlyActive(bucket.lastUsedAt))
      .map((bucket) => bucket.configFingerprint),
  )
  const expiredIdleSlots = idleMaterializedSlots.filter((slot) =>
    slot.configFingerprint && !activeFingerprints.has(slot.configFingerprint),
  )
  while (expiredIdleSlots.length > 0) {
    const slot = expiredIdleSlots.pop()
    if (!slot?.runtimeClient) continue
    await coolDownWarmRuntimeSlot(slot)
  }
  const eligibleIdleSlots = idleMaterializedSlots.filter((slot) =>
    !slot.configFingerprint || activeFingerprints.has(slot.configFingerprint),
  )
  while (eligibleIdleSlots.length > desiredReadyWarmRuntimeCount) {
    const slot = eligibleIdleSlots.pop()
    if (!slot?.runtimeClient) continue
    await coolDownWarmRuntimeSlot(slot)
  }
}

async function coolDownWarmRuntimeSlot(slot: WarmPoolSlot) {
  const client = slot.runtimeClient
  if (!client || slot.leased || slot.preparingRuntime) return
  // 中文/English: cooling down an idle warm runtime should keep the warm shell
  // container/workspace but release the ACP process memory back to the worker.
  slot.runtimeClient = undefined
  slot.runtimeClientPromise = undefined
  slot.configFingerprint = undefined
  await client.close().catch(() => {})
}

async function warmMaterializedRuntimeClient(slot: WarmPoolSlot, client: AcpProcessClient) {
  if (slot.leased && (slot.leaseRefCount ?? 0) > 0) return
  // 中文/English: pre-open one short-lived ACP session so the first real lease
  // avoids repeating plugin/provider/skill bootstrap.
  // 中文/English: session prewarm reserves a warm slot with `leased=true` but
  // `leaseRefCount=0`. That reservation is not a live session yet, so it still
  // must execute one bootstrap newSession/closeSession pair here.
  slot.preparingRuntime = true
  try {
    // 中文/English: bootstrap against the slot's mounted workspace layer rather
    // than the repo root, otherwise ACP pays an unnecessary project bootstrap on
    // `/workspace` before any real business session uses the slot.
    await client.newSession(slot.visiblePath)
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
  const localBuckets = mapDemandBuckets(warmRuntimeDemandByWorker.get(workerId))
  if (localBuckets.length > 0) return localBuckets
  return []
}

function mapDemandBuckets(
  buckets: Map<string, {
    configContent?: string
    hitCount: number
    lastUsedAt: number
  }> | undefined,
) {
  return [...(buckets?.entries() || [])]
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

function countReadyWarmRuntimeSlots(workerId: string) {
  return readWarmPool(workerId).filter((slot) =>
    slot.ready &&
    !slot.leased &&
    !slot.preparingRuntime &&
    Boolean(slot.runtimeClient),
  ).length
}

function selectGenericWarmSlotForMaterialize(
  slots: WarmPoolSlot[],
  buckets: Array<{
    configFingerprint: string
    configContent?: string
    lastUsedAt?: number
  }>,
  target: number,
) {
  const genericSlots = slots.filter((slot) =>
    slot.ready
    && !slot.leased
    && !slot.preparingRuntime
    && !slot.runtimeClient
    && !slot.runtimeClientPromise
    && !slot.configFingerprint,
  )
  if (!genericSlots.length) return
  const genericReserve = readGenericWarmSlotReserve(slots, buckets, target)
  return genericSlots.slice(0, Math.max(0, genericSlots.length - genericReserve))[0]
}

function readGenericWarmSlotReserve(
  slots: WarmPoolSlot[],
  buckets: Array<{
    configFingerprint: string
    configContent?: string
    lastUsedAt?: number
  }>,
  target: number,
) {
  if (target <= 1) return 0
  const readyGenericCount = countReadyGenericWarmPoolSlots(slots)
  if (readyGenericCount <= 1) return 0
  const hasReadyMaterializedSlot = buckets.some((bucket) =>
    slots.some((slot) =>
      slot.ready
      && !slot.leased
      && !slot.preparingRuntime
      && Boolean(slot.runtimeClient)
      && slot.configFingerprint === bucket.configFingerprint,
    ),
  )
  if (buckets.length > 1) return GENERIC_WARM_SLOT_RESERVE
  if (!hasReadyMaterializedSlot) return GENERIC_WARM_SLOT_RESERVE
  return 0
}

function readDesiredReadyWarmRuntimeCount(
  target: number,
  buckets: Array<{
    configFingerprint: string
    configContent?: string
    lastUsedAt?: number
  }>,
) {
  // 中文/English: idle workers should keep warm shells only. Materialized ACP
  // runtimes are created only after real config demand appears, otherwise each
  // worker eagerly burns memory at startup before any user traffic arrives.
  const activeBuckets = buckets.filter((bucket) => isWarmRuntimeBucketRecentlyActive(bucket.lastUsedAt))
  if (!activeBuckets.length) return 0
  // 中文/English: keep at most one long-lived materialized runtime per worker.
  // Additional capacity stays as warm shells so we preserve quick container
  // reuse without multiplying hundreds of MB of idle ACP heap per worker.
  return Math.min(target, activeBuckets.length, 1)
}

function selectWarmRuntimeBucketForMaterialize(
  slots: WarmPoolSlot[],
  buckets: Array<{
    configFingerprint: string
    configContent?: string
    lastUsedAt?: number
  }>,
) {
  return buckets
    .filter((bucket) => isWarmRuntimeBucketRecentlyActive(bucket.lastUsedAt))
    .map((bucket) => ({
      bucket,
      readyCount: slots.filter((slot) =>
        slot.ready &&
        !slot.leased &&
        !slot.preparingRuntime &&
        Boolean(slot.runtimeClient) &&
        slot.configFingerprint === bucket.configFingerprint,
      ).length,
    }))
    .sort((left, right) => left.readyCount - right.readyCount)
    .at(0)?.bucket
}

function isWarmRuntimeBucketRecentlyActive(lastUsedAt?: number) {
  if (!lastUsedAt) return false
  // 中文/English: only recently used configs keep a materialized ACP runtime.
  // Long-idle workers fall back to warm shells so idle heap does not accumulate.
  return Date.now() - lastUsedAt <= WARM_RUNTIME_IDLE_COOLDOWN_MS
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
