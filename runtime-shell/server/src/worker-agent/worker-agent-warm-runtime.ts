import { AcpProcessClient } from "../acp/acp-process-client"
import { computeRuntimeConfigFingerprint } from "../runtime/runtime-config-content"
import { attachDockerSandboxAcp } from "./sandbox/docker-sandbox-acp"
import {
  readWarmPool,
  destroyWarmPoolSlot,
  getLeasedWarmPoolSlot,
  getWarmPoolSlotById,
  prepareWarmPoolWorkspace,
  releaseWarmPoolSlot,
  takeWarmPoolSlot,
} from "./sandbox/docker-sandbox-warm-pool"
import { WARM_POOL_RUNTIME_CWD, type WarmPoolSlot } from "./sandbox/docker-sandbox-state"
import type { SandboxHandle } from "./sandbox/sandbox-types"
import { createBoundRuntimeEntryFromClient } from "./worker-agent-runtime-support"

const pendingWarmRuntimeBySession = new Map<string, Promise<void>>()
const pendingWarmRuntimeBackfillByWorker = new Map<string, Promise<void>>()
const WARM_RUNTIME_PREWARM_GRACE_MS = 3_000
const GENERIC_WARM_SLOT_RESERVE = 1
const warmRuntimeDemandByWorker = new Map<string, Map<string, {
  configContent?: string
  hitCount: number
  lastUsedAt: number
}>>()
const WARM_RUNTIME_DEMAND_TTL_MS = 30 * 60 * 1000

type WarmRuntimeRequest = {
  runtimeShellBaseUrl: string
  workerToken: string
  businessSessionId: string
  workspaceId: string
  workspacePath: string
  sandboxPath: string
  workerId: string
  configContent?: string
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
  // 中文/English: session/create warmup should only backfill worker-local warm
  // capacity. It must not bind a ready slot to this session before open happens.
  await backfillReadyWarmRuntimeSlots(input.workerId)
}

async function ensureWarmRuntimeClient(slot: WarmPoolSlot, input: {
  businessSessionId: string
  workspaceId: string
  workerId: string
  configContent?: string
}) {
  if (slot.runtimeClient) return slot.runtimeClient
  const handle = createWarmRuntimeClientHandle(slot, input)
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
  } catch (error) {
    client.terminate("warm runtime initialize failed")
    throw error
  } finally {
    slot.preparingRuntime = false
  }
  slot.runtimeClient = client
  client.onExit(() => {
    if (getWarmPoolSlotById(slot.id)?.runtimeClient !== client) return
    slot.runtimeClient = undefined
    void destroyWarmPoolSlot(slot).catch(() => {})
  })
  return client
}

async function doBackfillReadyWarmRuntimeSlots(workerId: string) {
  const warmRuntimeBuckets = listWarmRuntimeBuckets(workerId)
  if (!warmRuntimeBuckets.length) return
  const genericSlots = readWarmPool(workerId)
    .filter((slot) =>
      slot.ready
      && !slot.leased
      && !slot.preparingRuntime
      && !slot.runtimeClient
      && !slot.configFingerprint,
    )
  const genericReserve = warmRuntimeBuckets.length > 1 ? GENERIC_WARM_SLOT_RESERVE : 0
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
  if (slot.runtimeClient || slot.preparingRuntime || slot.leased) return
  slot.configFingerprint = bucket.configFingerprint
  try {
    await ensureWarmRuntimeClient(slot, {
      businessSessionId: `warm_pool_${slot.id}`,
      workspaceId: `warm_pool_${slot.id}`,
      workerId: slot.workerId,
      configContent: bucket.configContent,
    })
  } catch (error) {
    await destroyWarmPoolSlot(slot).catch(() => {})
    throw error
  }
}

async function ensureWarmRuntimeSlotReady(slot: WarmPoolSlot, input: WarmRuntimeRequest) {
  const handle = toWarmSandboxHandle(slot, input)
  try {
    await prepareWarmPoolWorkspace(handle)
    const client = await ensureWarmRuntimeClient(slot, input)
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
