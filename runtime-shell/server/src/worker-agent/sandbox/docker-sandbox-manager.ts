import { PassThrough } from "node:stream"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { Config } from "../../config"
import { hasRuntimeActivityByWorkspaceId } from "../worker-agent-store"
import type { SandboxManager } from "./sandbox-manager"
import type { SandboxHandle } from "./sandbox-types"
import { warmPoolByWorker, warmPoolTargetByWorker, WARM_POOL_RUNTIME_CWD } from "./docker-sandbox-state"
import { attachDockerSandboxAcp } from "./docker-sandbox-acp"
import {
  ensureDockerReady,
  removeContainer,
} from "./docker-sandbox-container"
import {
  cleanupOrphanRuntimeContainers,
  cleanupOrphanWarmPoolContainers,
  createWarmPoolSlot,
  destroyWarmPoolSlot,
  prepareWarmPoolWorkspace,
  pruneMissingWarmPoolSlots,
  readWarmPool,
  reclaimStaleLeasedWarmPoolSlots,
  releaseWarmPoolSlot,
  takeWarmPoolSlot,
  toWarmPoolSnapshot,
} from "./docker-sandbox-warm-pool"

export function createDockerSandboxManager(): SandboxManager {
  return {
    prepare(input) {
      const warmSlot = takeWarmPoolSlot(input.workerId, input.businessSessionId, input.workspaceId, input.configFingerprint)
      if (warmSlot) {
        return {
          workerId: input.workerId,
          businessSessionId: input.businessSessionId,
          workspaceId: input.workspaceId,
          containerName: warmSlot.containerName,
          workspacePath: warmSlot.visiblePath,
          sandboxPath: input.sandboxPath,
          runtimeCwd: WARM_POOL_RUNTIME_CWD,
          poolSlotId: warmSlot.id,
        }
      }
      return {
        workerId: input.workerId,
        businessSessionId: input.businessSessionId,
        workspaceId: input.workspaceId,
        containerName: toRuntimeContainerName(input.workerId, input.workspaceId),
        workspacePath: input.workspacePath,
        sandboxPath: input.sandboxPath,
        runtimeCwd: input.sandboxPath || input.workspacePath,
      }
    },
    attachAcp(input) {
      return attachDockerSandboxAcp(input)
    },
    async close(input) {
      await closeDockerSandbox(input.handle)
    },
  }
}

export async function ensureDockerWarmPool(input: {
  workerId: string
  target: number
}) {
  if (Config.sandboxBackend === "local-process") {
    return {
      workerId: input.workerId,
      target: 0,
      totalCount: 0,
      readyCount: 0,
      leasedCount: 0,
    }
  }
  warmPoolTargetByWorker.set(input.workerId, Math.max(0, input.target))
  await ensureDockerReady()
  // 中文/English: worker heartbeats call `ensureDockerWarmPool()` continuously, so
  // orphan runtime containers must be reclaimed here as well. Otherwise old
  // `runtime-shell-acp-*` sandboxes can survive rebuilds/restarts indefinitely.
  await cleanupOrphanRuntimeContainers(input.workerId)
  await cleanupOrphanWarmPoolContainers(input.workerId)
  const workerPool = readWarmPool(input.workerId)
  await reclaimStaleLeasedWarmPoolSlots(input.workerId)
  await pruneMissingWarmPoolSlots(workerPool)
  while (workerPool.length < input.target) {
    workerPool.push(await createWarmPoolSlot(input.workerId))
  }
  const removable = workerPool.filter((slot) => slot.ready && !slot.leased)
  while (removable.length > input.target) {
    const slot = removable.pop()
    if (!slot) break
    await destroyWarmPoolSlot(slot)
  }
  return toWarmPoolSnapshot(input.workerId, readWarmPool(input.workerId))
}

export async function cleanupDockerWarmPool(input: {
  workerId?: string
  recycleReady?: boolean
}) {
  if (Config.sandboxBackend === "local-process") {
    return {
      workers: [],
      cleanedReadyCount: 0,
      reclaimedStaleLeasedCount: 0,
    }
  }
  await ensureDockerReady()
  const workerIds = input.workerId
    ? [input.workerId]
    : [...new Set([...warmPoolByWorker.keys(), ...Config.localWorkers.map((worker) => worker.id)])]
  const workers = []
  let cleanedReadyCount = 0
  let reclaimedStaleLeasedCount = 0
  for (const workerId of workerIds) {
    cleanedReadyCount += await cleanupOrphanRuntimeContainers(workerId)
    cleanedReadyCount += await cleanupOrphanWarmPoolContainers(workerId)
    reclaimedStaleLeasedCount += await reclaimStaleLeasedWarmPoolSlots(workerId)
    await pruneMissingWarmPoolSlots(readWarmPool(workerId))
    if (input.recycleReady) {
      const readySlots = [...readWarmPool(workerId)].filter((slot) => slot.ready && !slot.leased)
      cleanedReadyCount += readySlots.length
      for (const slot of readySlots) {
        await destroyWarmPoolSlot(slot)
      }
    }
    workers.push(toWarmPoolSnapshot(workerId, readWarmPool(workerId)))
  }
  return {
    workers,
    cleanedReadyCount,
    reclaimedStaleLeasedCount,
  }
}

export async function cleanupDockerWarmPoolProcessExit() {
  if (Config.sandboxBackend === "local-process") return
  await ensureDockerReady()
  for (const workerId of [...warmPoolByWorker.keys()]) {
    for (const slot of [...readWarmPool(workerId)]) {
      await destroyWarmPoolSlot(slot)
    }
    warmPoolByWorker.delete(workerId)
    warmPoolTargetByWorker.delete(workerId)
  }
}

export function getDockerWarmPoolSnapshot(workerId?: string) {
  if (Config.sandboxBackend === "local-process") {
    return workerId
      ? {
          workerId,
          target: 0,
          totalCount: 0,
          readyCount: 0,
          leasedCount: 0,
        }
      : {
          items: [],
          totalReady: 0,
          totalLeased: 0,
        }
  }
  if (workerId) return toWarmPoolSnapshot(workerId, readWarmPool(workerId))
  const items = [...warmPoolByWorker.entries()].map(([nextWorkerId, slots]) => toWarmPoolSnapshot(nextWorkerId, slots))
  return {
    items,
    totalReady: items.reduce((sum, item) => sum + item.readyCount, 0),
    totalLeased: items.reduce((sum, item) => sum + item.leasedCount, 0),
  }
}

export async function closeDockerWarmPoolSlot(input: {
  workerId: string
  slotId: string
}) {
  const slot = readWarmPool(input.workerId).find((item) => item.id === input.slotId)
  if (!slot) {
    return {
      workerId: input.workerId,
      slotId: input.slotId,
      closed: false,
      reason: "slot_not_found",
    }
  }
  // 中文/English: admin close must reclaim the exact warm slot immediately so
  // the worker-side pool view and API-visible snapshot stay consistent.
  await destroyWarmPoolSlot(slot)
  return {
    workerId: input.workerId,
    slotId: input.slotId,
    closed: true,
  }
}

export async function closeOrphanDockerSandbox(input: {
  businessSessionId: string
  workspaceId: string
  workerId: string
}) {
  if (Config.sandboxBackend === "local-process") return
  await ensureDockerReady()
  await removeContainer(toRuntimeContainerName(input.workerId, input.workspaceId))
}

async function closeDockerSandbox(handle: SandboxHandle) {
  if (handle.closePromise) return handle.closePromise
  handle.closePromise = (async () => {
    await handle.bootPromise?.catch(() => {})
    if (handle.poolSlotId) {
      await releaseWarmPoolSlot(handle)
      return
    }
    if (!handle.containerName) return
    if (handle.workspaceId && hasRuntimeActivityByWorkspaceId(handle.workspaceId)) return
    await removeContainer(handle.containerName)
  })()
  return handle.closePromise
}

function toRuntimeContainerName(workerId: string, workspaceId: string) {
  const suffix = `${workerId}__ws__${workspaceId}`.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(-100)
  return `runtime-shell-acp-${suffix}`
}
