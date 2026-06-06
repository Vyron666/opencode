import { cp, mkdir, readdir, rm } from "node:fs/promises"
import path from "node:path"
import { Config } from "../../config"
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
import { buildWarmRuntimeHomePath, removeRuntimeHome } from "./docker-sandbox-runtime-home"
import {
  WARM_POOL_RUNTIME_CWD,
  WARM_SLOT_RUNTIME_MISSING_GRACE_MS,
  docker,
  log,
  runWithWarmPoolCopyGate,
  warmPoolByWorker,
  warmPoolTargetByWorker,
  type WarmPoolSlot,
} from "./docker-sandbox-state"
import { runColdStartWarmSlotCreate } from "./docker-sandbox-cold-start"
import type { SandboxHandle } from "./sandbox-types"

export function readWarmPool(workerId: string) {
  const existing = warmPoolByWorker.get(workerId)
  if (existing) return existing
  const created: WarmPoolSlot[] = []
  warmPoolByWorker.set(workerId, created)
  return created
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
  slot.leased = true
  slot.ready = false
  slot.leasedAt = new Date().toISOString()
  slot.leasedSessionId = businessSessionId
  slot.leasedWorkspaceId = workspaceId
  slot.leaseRefCount = 1
  slot.workspacePrepared = false
  slot.configFingerprint = configFingerprint
  return slot
}

export async function reserveWarmPoolSlot(input: {
  workerId: string
  businessSessionId: string
  workspaceId: string
  configFingerprint: string
}) {
  const pool = readWarmPool(input.workerId)
  const existing = findLeasedWarmPoolSlot(pool, input)
  if (existing) return existing
  const ready = findReadyWarmPoolSlot(pool, input.configFingerprint, { allowGeneric: true })
  if (!ready) return
  // 中文/English: session prewarm may only borrow an existing ready slot.
  // Never expand the pool per session, otherwise speculative prewarm turns into
  // an uncontrolled initialize storm under concurrent open traffic.
  ready.leased = true
  ready.ready = false
  ready.leasedAt = new Date().toISOString()
  ready.leasedSessionId = input.businessSessionId
  ready.leasedWorkspaceId = input.workspaceId
  ready.leaseRefCount = 0
  ready.workspacePrepared = false
  ready.configFingerprint = input.configFingerprint
  return ready
}

export async function createWarmPoolSlot(
  workerId: string,
  configFingerprint?: string,
): Promise<WarmPoolSlot> {
  return runColdStartWarmSlotCreate(async () => {
    const slotId = `warm_${crypto.randomUUID().replace(/-/g, "")}`
    const visiblePath = path.join(Config.workspaceRootDir, ".warm-pool", workerId, slotId)
    const runtimeHomePath = buildWarmRuntimeHomePath({ workerId, slotId })
    await rm(visiblePath, { recursive: true, force: true }).catch(() => {})
    await mkdir(visiblePath, { recursive: true })
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
    } satisfies WarmPoolSlot
    readWarmPool(workerId).push(slot)
    try {
      const container = await ensureContainer({
        containerName,
        handle,
        cwd: visiblePath,
      })
      await startContainerIfNeeded(container)
      return slot
    } catch (error) {
      await destroyWarmPoolSlot(slot).catch(() => {})
      throw error
    }
  })
}

export async function destroyWarmPoolSlot(slot: WarmPoolSlot) {
  const pool = readWarmPool(slot.workerId)
  const index = pool.findIndex((item) => item.id === slot.id)
  if (index >= 0) pool.splice(index, 1)
  slot.runtimeClient?.terminate("warm runtime slot destroyed")
  slot.runtimeClient = undefined
  await removeContainer(slot.containerName)
  await rm(slot.visiblePath, { recursive: true, force: true }).catch(() => {})
  await removeRuntimeHome(slot.runtimeHomePath)
}

export async function cleanupOrphanWarmPoolContainers(workerId: string) {
  const containers = await docker.listContainers({ all: true })
  let cleaned = 0
  for (const container of containers) {
    const matchedName = readContainerName(container)
    const identity = readWarmPoolContainerIdentity(container, matchedName)
    if (!matchedName || !identity || identity.workerId !== workerId) continue
    if (readWarmPool(workerId).some((slot) => slot.containerName === matchedName)) continue
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
        filter: (source) => !isInnerSandboxPath(source),
      })
    }
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
  const readyCount = readWarmPool(slot.workerId).filter((item) => item.ready && !item.leased).length
  if (readyCount > target && target >= 0) {
    await destroyWarmPoolSlot(slot)
  }
}

export function toWarmPoolSnapshot(workerId: string, slots: WarmPoolSlot[]) {
  return {
    workerId,
    target: warmPoolTargetByWorker.get(workerId) ?? 0,
    totalCount: slots.length,
    readyCount: slots.filter((slot) => slot.ready && !slot.leased).length,
    leasedCount: slots.filter((slot) => slot.leased).length,
    slots: slots.map((slot) => ({
      slotId: slot.id,
      containerName: slot.containerName,
      visiblePath: slot.visiblePath,
      runtimeHomePath: slot.runtimeHomePath,
      status: slot.leased ? "leased" : slot.ready ? "warm" : "preparing",
      configFingerprint: slot.configFingerprint,
      createdAt: slot.createdAt,
      leasedAt: slot.leasedAt,
      leasedSessionId: slot.leasedSessionId,
      leasedWorkspaceId: slot.leasedWorkspaceId,
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
    && item.configFingerprint === configFingerprint,
  )
  if (matched) return matched
  if (!input?.allowGeneric) return
  return pool.find((item) =>
    item.ready
    && !item.leased
    // 中文/English: heartbeat-created warm slots start as generic warm shells.
    // The first real session with a concrete config fingerprint can claim one and
    // turn it into a long-lived warm runtime for that config bucket.
    && !item.runtimeClient
    && !item.configFingerprint,
  )
}
