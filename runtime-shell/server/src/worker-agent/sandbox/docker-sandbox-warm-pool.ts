import { cp, mkdir, readdir, rm } from "node:fs/promises"
import path from "node:path"
import { Config } from "../../config"
import { ensureSandboxUserOwnership } from "../../lib/sandbox-user-ownership"
import {
  hasRuntimeActivityByWorkspaceId,
  listClaimedContainerNames,
  listRuntimeContainerNames,
} from "../worker-agent-store"
import {
  containerExists,
  ensureContainer,
  readContainerName,
  readRuntimeContainerIdentity,
  readWarmPoolContainerIdentity,
  removeContainer,
  startContainerIfNeeded,
} from "./docker-sandbox-container"
import {
  buildWarmRuntimeHomePath,
  buildWarmRuntimeHomeRoot,
  removeRuntimeHome,
} from "./docker-sandbox-runtime-home"
import {
  getWorkerAgentStartedAtMs,
  getWorkerAgentInstanceId,
  isWorkerAgentShuttingDown,
  WARM_POOL_RUNTIME_CWD,
  WARM_SLOT_RUNTIME_MISSING_GRACE_MS,
  docker,
  log,
  pendingWarmPoolCreateCountByWorker,
  runWithWarmPoolCopyGate,
  warmPoolByWorker,
  warmPoolTargetByWorker,
  type WarmPoolSlot,
} from "./docker-sandbox-state"
import { runColdStartWarmSlotCreate } from "./docker-sandbox-cold-start"
import type { SandboxHandle } from "./sandbox-types"

let warmPoolReleaseObserver: ((workerId: string) => void) | undefined
const pendingWarmPoolReserveByWorker = new Map<string, Promise<unknown>>()

export function readWarmPool(workerId: string) {
  const existing = warmPoolByWorker.get(workerId)
  if (existing) return existing
  const created: WarmPoolSlot[] = []
  warmPoolByWorker.set(workerId, created)
  return created
}

export function setWarmPoolReleaseObserver(observer: ((workerId: string) => void) | undefined) {
  warmPoolReleaseObserver = observer
}

export function getWarmPoolSlotById(slotId?: string) {
  if (!slotId) return
  return [...warmPoolByWorker.values()].flat().find((item) => item.id === slotId)
}

export function getLeasedWarmPoolSlot(input: {
  workerId: string
  businessSessionId: string
  workspaceId: string
}) {
  return readWarmPool(input.workerId).find((item) =>
    item.leased
    && item.leasedSessionId === input.businessSessionId
    && item.leasedWorkspaceId === input.workspaceId,
  )
}

export function takeWarmPoolSlot(workerId: string, businessSessionId: string, workspaceId: string, configFingerprint?: string) {
  const pool = readWarmPool(workerId)
  const leasedSlot = findLeasedWarmPoolSlot(pool, {
    businessSessionId,
    workspaceId,
    configFingerprint,
  })
  if (leasedSlot) {
    leasedSlot.leasedSessionId = businessSessionId
    leasedSlot.leaseRefCount = (leasedSlot.leaseRefCount ?? 0) + 1
    return leasedSlot
  }
  const slot = findReadyWarmPoolSlot(pool, configFingerprint, { allowGeneric: true })
  if (!slot) return
  return leaseWarmPoolSlot(slot, {
    businessSessionId,
    workspaceId,
    configFingerprint,
  }, 1)
}

export async function reserveWarmPoolSlot(input: {
  workerId: string
  businessSessionId: string
  workspaceId: string
  configFingerprint: string
  warmPoolTarget?: number
}) {
  return runWarmPoolReservation(input.workerId, () => reserveWarmPoolSlotInner(input))
}

async function reserveWarmPoolSlotInner(input: {
  workerId: string
  businessSessionId: string
  workspaceId: string
  configFingerprint: string
  warmPoolTarget?: number
}) {
  const pool = readWarmPool(input.workerId)
  const existing = findLeasedWarmPoolSlot(pool, input)
  if (existing) return existing
  const ready = findReadyWarmPoolSlot(pool, input.configFingerprint, { allowGeneric: true })
  if (!ready) {
    const createdReady = await createReservableWarmPoolSlot(input.workerId, input.configFingerprint, input.warmPoolTarget)
    if (!createdReady) return
    return leaseWarmPoolSlot(createdReady, input, 0)
  }
  // 中文/English: prewarm leases the slot without an active runtime reference;
  // the later open call on the same session upgrades the same lease.
  return leaseWarmPoolSlot(ready, input, 0)
}

async function runWarmPoolReservation<T>(workerId: string, task: () => Promise<T>) {
  const previous = pendingWarmPoolReserveByWorker.get(workerId)
  const current = (async () => {
    await previous?.catch(() => {})
    return task()
  })()
  pendingWarmPoolReserveByWorker.set(workerId, current)
  try {
    return await current
  } finally {
    if (pendingWarmPoolReserveByWorker.get(workerId) === current) {
      pendingWarmPoolReserveByWorker.delete(workerId)
    }
  }
}

export async function createWarmPoolSlot(
  workerId: string,
  configFingerprint?: string,
): Promise<WarmPoolSlot> {
  return runColdStartWarmSlotCreate(async () => {
    if (isWorkerAgentShuttingDown()) {
      throw new Error("worker agent is shutting down")
    }
    pendingWarmPoolCreateCountByWorker.set(workerId, (pendingWarmPoolCreateCountByWorker.get(workerId) ?? 0) + 1)
    const slotId = `warm_${crypto.randomUUID().replace(/-/g, "")}`
    const visiblePath = path.join(Config.workspaceRootDir, ".warm-pool", workerId, slotId)
    const runtimeHomePath = buildWarmRuntimeHomePath({ workerId, slotId })
    await rm(visiblePath, { recursive: true, force: true }).catch(() => {})
    await mkdir(visiblePath, { recursive: true })
    await ensureSandboxUserOwnership(visiblePath)
    const containerName = `runtime-shell-warm-${workerId}-${slotId}`.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(-120)
    const handle: SandboxHandle = {
      workerId,
      containerName,
      workspacePath: visiblePath,
      runtimeCwd: WARM_POOL_RUNTIME_CWD,
      runtimeHomePath,
      poolSlotId: slotId,
    }
    const slot = {
      id: slotId,
      workerId,
      ownerInstanceId: getWorkerAgentInstanceId(),
      containerName,
      visiblePath,
      runtimeHomePath,
      configFingerprint,
      ready: true,
      leased: false,
      leasedAt: undefined,
      leasedSessionId: undefined,
      leasedWorkspaceId: undefined,
      createdAt: new Date().toISOString(),
      leaseRefCount: 0,
      workspacePrepared: false,
      preparingRuntime: false,
      runtimeClient: undefined,
      runtimeClientPromise: undefined,
    } satisfies WarmPoolSlot
    readWarmPool(workerId).push(slot)
    try {
      const container = await ensureContainer({
        containerName,
        handle,
        cwd: visiblePath,
        ownerInstanceId: slot.ownerInstanceId,
      })
      await startContainerIfNeeded(container)
      return slot
    } catch (error) {
      await destroyWarmPoolSlot(slot).catch(() => {})
      throw error
    } finally {
      const nextPendingCreateCount = Math.max(0, (pendingWarmPoolCreateCountByWorker.get(workerId) ?? 1) - 1)
      if (nextPendingCreateCount === 0) {
        pendingWarmPoolCreateCountByWorker.delete(workerId)
      } else {
        pendingWarmPoolCreateCountByWorker.set(workerId, nextPendingCreateCount)
      }
    }
  })
}

function leaseWarmPoolSlot(
  slot: WarmPoolSlot,
  input: {
    businessSessionId: string
    workspaceId: string
    configFingerprint?: string
  },
  leaseRefCount: number,
) {
  slot.leased = true
  slot.ready = false
  slot.leasedAt = new Date().toISOString()
  slot.leasedSessionId = input.businessSessionId
  slot.leasedWorkspaceId = input.workspaceId
  slot.leaseRefCount = leaseRefCount
  slot.workspacePrepared = false
  slot.configFingerprint = input.configFingerprint
  return slot
}

async function createReservableWarmPoolSlot(workerId: string, configFingerprint: string, targetHint?: number) {
  if (isWorkerAgentShuttingDown()) return
  if (!warmPoolTargetByWorker.has(workerId) && targetHint !== undefined) {
    // 中文/English: session prewarm can beat the first heartbeat after restart;
    // use the scheduler-known target only to initialize that empty worker view.
    warmPoolTargetByWorker.set(workerId, targetHint)
  }
  const pool = readWarmPool(workerId)
  while (!findReadyWarmPoolSlot(pool, configFingerprint, { allowGeneric: true })) {
    const target = warmPoolTargetByWorker.get(workerId) ?? 0
    const pendingCreateCount = pendingWarmPoolCreateCountByWorker.get(workerId) ?? 0
    if (target <= 0 || pool.length + pendingCreateCount >= target) return
    // 中文/English: reserve is already serialized per worker, so create directly
    // inside the configured warm target instead of keeping a second create queue.
    await createWarmPoolSlot(workerId)
  }
  return findReadyWarmPoolSlot(pool, configFingerprint, { allowGeneric: true })
}

export async function destroyWarmPoolSlot(slot: WarmPoolSlot) {
  const pool = readWarmPool(slot.workerId)
  const index = pool.findIndex((item) => item.id === slot.id)
  if (index >= 0) pool.splice(index, 1)
  const pendingRuntimeClient = slot.runtimeClientPromise
  slot.runtimeClient?.terminate("warm runtime slot destroyed")
  slot.runtimeClient = undefined
  slot.runtimeClientPromise = undefined
  pendingRuntimeClient?.then((client) => {
    client.terminate("warm runtime slot destroyed during initialize")
  }).catch(() => {})
  await removeContainer(slot.containerName)
  await rm(slot.visiblePath, { recursive: true, force: true }).catch(() => {})
  await removeRuntimeHome(slot.runtimeHomePath)
}

export async function cleanupOrphanWarmPoolContainers(workerId: string) {
  const containers = await docker.listContainers({ all: true })
  let cleaned = 0
  const ownerInstanceId = getWorkerAgentInstanceId()
  const workerStartedAtMs = getWorkerAgentStartedAtMs()
  const liveSlotIds = new Set<string>()
  for (const container of containers) {
    const matchedName = readContainerName(container)
    const identity = readWarmPoolContainerIdentity(container, matchedName)
    if (!matchedName || !identity || identity.workerId !== workerId) continue
    liveSlotIds.add(identity.slotId)
    if (readWarmPool(workerId).some((slot) => slot.containerName === matchedName)) continue
    if (
      identity.ownerInstanceId
      && identity.ownerInstanceId !== ownerInstanceId
      && Number(container.Created || 0) * 1000 >= workerStartedAtMs
    ) continue
    const visiblePath = path.join(Config.workspaceRootDir, ".warm-pool", workerId, identity.slotId)
    const runtimeHomePath = buildWarmRuntimeHomePath({ workerId, slotId: identity.slotId })
    log.info("cleaning orphan warm pool container", {
      workerId,
      containerName: matchedName,
      visiblePath,
      runtimeHomePath,
    })
    await removeContainer(matchedName)
    await rm(visiblePath, { recursive: true, force: true }).catch(() => {})
    await removeRuntimeHome(runtimeHomePath)
    cleaned += 1
  }
  cleaned += await cleanupOrphanWarmPoolArtifacts(workerId, liveSlotIds)
  return cleaned
}

export async function cleanupOrphanRuntimeContainers(workerId: string) {
  const containers = await docker.listContainers({ all: true })
  let cleaned = 0
  for (const container of containers) {
    const matchedName = readContainerName(container)
    const identity = readRuntimeContainerIdentity(container, matchedName)
    if (!matchedName || !identity || identity.workerId !== workerId) continue
    if (isTrackedRuntimeContainer(matchedName, identity.workspaceId, workerId)) continue
    log.info("cleaning orphan runtime sandbox container", {
      workerId,
      containerName: matchedName,
    })
    await removeContainer(matchedName)
    cleaned += 1
  }
  return cleaned
}

export async function pruneMissingWarmPoolSlots(slots: WarmPoolSlot[]) {
  await Promise.all([...slots]
    .filter((slot) => !slot.leased)
    .map(async (slot) => {
      if (await containerExists(slot.containerName)) return
      await destroyWarmPoolSlot(slot)
    }))
}

export async function prepareWarmPoolWorkspace(handle: SandboxHandle) {
  const slot = getWarmPoolSlotById(handle.poolSlotId)
  const sandboxPath = handle.sandboxPath
  if (!slot || !sandboxPath) return
  if (slot.workspacePrepared && slot.leasedWorkspaceId === handle.workspaceId) return
  await runWithWarmPoolCopyGate(async () => {
    // 中文/English: keep the bind-mounted slot root stable while the warm ACP
    // process stays alive, otherwise deleting the mount source can invalidate reuse.
    await resetDirectoryContents(slot.visiblePath)
    if (!await isDirectoryEmpty(sandboxPath)) {
      await cp(sandboxPath, slot.visiblePath, {
        recursive: true,
        force: true,
        // 中文/English: copying from one workspace sandbox root into a warm slot
        // must keep that workspace tree intact; only nested `.sandbox` paths inside
        // the source tree should be excluded, not the source sandbox root itself.
        filter: (source) => !isNestedSandboxArtifactPath(sandboxPath, source),
      })
    }
    await ensureSandboxUserOwnership(slot.visiblePath)
    slot.workspacePrepared = true
  })
}

export async function releaseWarmPoolSlot(handle: SandboxHandle) {
  const slot = getWarmPoolSlotById(handle.poolSlotId)
  if (!slot) return
  const nextRefCount = Math.max(0, (slot.leaseRefCount ?? 0) - 1)
  slot.leaseRefCount = nextRefCount
  if (nextRefCount > 0) return
  if (handle.invalidPoolSlot || !await containerExists(slot.containerName)) {
    await destroyWarmPoolSlot(slot)
    return
  }
  try {
    await syncWarmPoolWorkspaceBack(handle, slot)
  } catch (error) {
    log.warn("warm pool workspace sync back failed", {
      workerId: slot.workerId,
      slotId: slot.id,
      businessSessionId: slot.leasedSessionId,
      message: error instanceof Error ? error.message : String(error),
    })
    await destroyWarmPoolSlot(slot)
    return
  }
  await resetDirectoryContents(slot.visiblePath)
  slot.leased = false
  slot.ready = true
  slot.leasedAt = undefined
  slot.leasedSessionId = undefined
  slot.leasedWorkspaceId = undefined
  slot.workspacePrepared = false
  const target = warmPoolTargetByWorker.get(slot.workerId) ?? 0
  const totalCount = readWarmPool(slot.workerId).length
  if (totalCount > target && target >= 0) {
    await destroyWarmPoolSlot(slot)
    return
  }
  warmPoolReleaseObserver?.(slot.workerId)
}

export function toWarmPoolSnapshot(workerId: string, slots: WarmPoolSlot[]) {
  return {
    workerId,
    target: warmPoolTargetByWorker.get(workerId) ?? 0,
    totalCount: slots.length,
    readyCount: countReadyWarmRuntimeSlots(slots),
    warmShellReadyCount: countReadyWarmPoolSlots(slots),
    leasedCount: slots.filter((slot) => slot.leased).length,
    slots: slots.map((slot) => ({
      slotId: slot.id,
      containerName: slot.containerName,
      visiblePath: slot.visiblePath,
      runtimeHomePath: slot.runtimeHomePath,
      status: slot.leased ? "leased" : slot.ready && !slot.preparingRuntime ? "warm" : "preparing",
      configFingerprint: slot.configFingerprint,
      createdAt: slot.createdAt,
      leasedAt: slot.leasedAt,
      leasedSessionId: slot.leasedSessionId,
      leasedWorkspaceId: slot.leasedWorkspaceId,
      runtimeReady: Boolean(slot.runtimeClient),
    })),
  }
}
export async function reclaimStaleLeasedWarmPoolSlots(workerId: string) {
  let reclaimed = 0
  for (const slot of [...readWarmPool(workerId)].filter((item) => item.leased)) {
    if (!shouldReclaimLeasedWarmPoolSlot(slot)) continue
    log.warn("reclaiming stale leased warm pool slot", {
      workerId,
      slotId: slot.id,
      leasedAt: slot.leasedAt,
      leasedSessionId: slot.leasedSessionId,
    })
    await destroyWarmPoolSlot(slot)
    reclaimed += 1
  }
  return reclaimed
}

function isInnerSandboxPath(source: string) {
  const relative = path.relative(path.join(Config.workspaceRootDir, ".sandbox"), source)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function isNestedSandboxArtifactPath(root: string, source: string) {
  const relative = path.relative(root, source)
  if (relative === "") return false
  const normalized = relative.replace(/\\/g, "/")
  return normalized === ".sandbox" || normalized.startsWith(".sandbox/")
}

async function syncWarmPoolWorkspaceBack(handle: SandboxHandle, slot: WarmPoolSlot) {
  const sandboxPath = handle.sandboxPath
  if (!sandboxPath) return
  // 中文/English: close must copy the latest warm-slot workspace back so later
  // diff/open paths always see the same filesystem view for this session.
  await runWithWarmPoolCopyGate(async () => {
    await rm(sandboxPath, { recursive: true, force: true }).catch(() => {})
    await mkdir(sandboxPath, { recursive: true })
    if (!await isDirectoryEmpty(slot.visiblePath)) {
      await cp(slot.visiblePath, sandboxPath, {
        recursive: true,
        force: true,
        filter: (source) => !isInnerSandboxPath(source),
      })
    }
    await ensureSandboxUserOwnership(sandboxPath)
  })
}

function shouldReclaimLeasedWarmPoolSlot(slot: WarmPoolSlot) {
  if (!slot.leased) return false
  if (slot.preparingRuntime) return false
  if (!slot.leasedAt || !slot.leasedWorkspaceId) return true
  if (Date.now() - new Date(slot.leasedAt).getTime() < WARM_SLOT_RUNTIME_MISSING_GRACE_MS) return false
  return !hasRuntimeActivityByWorkspaceId(slot.leasedWorkspaceId)
}

function isTrackedRuntimeContainer(containerName: string, workspaceId: string, workerId: string) {
  const trackedContainerNames = new Set([
    ...listRuntimeContainerNames(workerId),
    ...listClaimedContainerNames(workerId),
  ])
  if (trackedContainerNames.has(containerName)) return true
  // 中文/English: re-check live activity right before delete so heartbeat cleanup
  // never removes a container that another open path just claimed.
  return hasRuntimeActivityByWorkspaceId(workspaceId)
}

async function resetDirectoryContents(targetDir: string) {
  await mkdir(targetDir, { recursive: true })
  await ensureSandboxUserOwnership(targetDir)
  const entries = await readdir(targetDir)
  await Promise.all(entries.map((entry) =>
    rm(path.join(targetDir, entry), { recursive: true, force: true }),
  ))
}

async function isDirectoryEmpty(targetDir: string) {
  await mkdir(targetDir, { recursive: true })
  const entries = await readdir(targetDir)
  return entries.length === 0
}

async function cleanupOrphanWarmPoolArtifacts(workerId: string, liveSlotIds: Set<string>) {
  const trackedSlotIds = new Set(readWarmPool(workerId).map((slot) => slot.id))
  const visibleRoot = path.join(Config.workspaceRootDir, ".warm-pool", workerId)
  const runtimeHomeRoot = buildWarmRuntimeHomeRoot(workerId)
  const [cleanedVisibleCount, cleanedRuntimeHomeCount] = await Promise.all([
    cleanupWarmPoolArtifactDir(visibleRoot, trackedSlotIds, liveSlotIds),
    cleanupWarmPoolArtifactDir(runtimeHomeRoot, trackedSlotIds, liveSlotIds),
  ])
  return cleanedVisibleCount + cleanedRuntimeHomeCount
}

async function cleanupWarmPoolArtifactDir(rootDir: string, trackedSlotIds: Set<string>, liveSlotIds: Set<string>) {
  const entries = await readdir(rootDir, { withFileTypes: true }).catch(() => [])
  let cleaned = 0
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (trackedSlotIds.has(entry.name)) continue
    if (liveSlotIds.has(entry.name)) continue
    await rm(path.join(rootDir, entry.name), { recursive: true, force: true }).catch(() => {})
    cleaned += 1
  }
  return cleaned
}

function findLeasedWarmPoolSlot(
  pool: WarmPoolSlot[],
  input: {
    businessSessionId: string
    workspaceId: string
    configFingerprint?: string
  },
) {
  return pool.find((item) =>
    item.leased
    && item.leasedSessionId === input.businessSessionId
    && item.leasedWorkspaceId === input.workspaceId
    && item.configFingerprint === input.configFingerprint,
  )
}

function findReadyWarmPoolSlot(
  pool: WarmPoolSlot[],
  configFingerprint?: string,
  input?: {
    allowGeneric?: boolean
  },
) {
  const matched = pool.find((item) =>
    item.ready
    && !item.leased
    && !item.preparingRuntime
    && item.configFingerprint === configFingerprint,
  )
  if (matched) return matched
  if (!input?.allowGeneric) return
  return pool.find((item) =>
    item.ready
    && !item.leased
    && !item.preparingRuntime
    // 中文/English: heartbeat-created warm slots start as generic warm shells.
    // The first real session with a concrete config fingerprint can claim one and
    // turn it into a long-lived warm runtime for that config bucket.
    && !item.runtimeClient
    && !item.configFingerprint,
  )
}

function countReadyWarmPoolSlots(slots: WarmPoolSlot[]) {
  return slots.filter((slot) => slot.ready && !slot.leased && !slot.preparingRuntime).length
}

export function countReadyWarmRuntimeSlots(slots: WarmPoolSlot[]) {
  return slots.filter((slot) =>
    slot.ready &&
    !slot.leased &&
    !slot.preparingRuntime &&
    Boolean(slot.runtimeClient),
  ).length
}

export function countReadyGenericWarmPoolSlots(slots: WarmPoolSlot[]) {
  return slots.filter((slot) =>
    slot.ready
    && !slot.leased
    && !slot.preparingRuntime
    && !slot.runtimeClient
    && !slot.runtimeClientPromise
    && !slot.configFingerprint,
  ).length
}
