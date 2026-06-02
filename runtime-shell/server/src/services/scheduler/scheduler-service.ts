import { Config } from "../../config"
import { createLogger } from "../../log"
import type { BusinessSession, User, WorkerNode } from "../../types"
import { sessionService, workerService } from "../store/store-singleton"
import { refreshLocalWorkersNow } from "../worker/local-worker-heartbeat-loop"

const CREATED_SESSION_RESERVATION_MS = 30000
const log = createLogger("scheduler-service")

export async function selectWorkerForNewSession(user: User, excludedWorkerIds: string[] = []) {
  const excluded = new Set(excludedWorkerIds.filter(Boolean))
  let workers = await workerService.listReadyWorkersForUser(user)
  if (!workers.length && Config.localWorkers.length) {
    // 中文/English: runtime-shell can start slightly earlier than local workers after a rebuild.
    // Refresh reachability on demand so the first create-and-enter request does not fail on this short gap.
    await refreshLocalWorkersNow()
    workers = await workerService.listReadyWorkersForUser(user)
  }
  if (!workers.length) {
    log.warn("worker selection found no ready workers", {
      tenantId: user.tenantId,
      organizationId: user.organizationId,
      requestedProjects: user.projectIds,
    })
    return
  }
  const sessions = await sessionService.listSessions()
  const candidates = workers
    .map((worker) => ({
      ...worker,
      // 中文/English: recompute live load from session state at scheduling time so
      // a stale persisted counter does not incorrectly block new session allocation.
      activeSessionCount: sessions.filter(
        (session) =>
          session.workerId === worker.id &&
          (isWorkerReservedSession(session) ||
            session.status === "opening" ||
            session.status === "active" ||
            session.status === "waiting_input" ||
            session.status === "cancelling" ||
            session.status === "closing"),
      ).length,
    }))
    .filter((worker) => supportsRuntimeExecution(worker))
    .filter((worker) => !excluded.has(worker.id))
    .filter((worker) => worker.activeSessionCount < worker.capacity)
    .sort(compareWorkers)
  const selected = candidates[0]
  if (!selected) {
    log.warn("worker selection exhausted candidates", {
      readyWorkerIds: workers.map((worker) => worker.id),
      readyWorkerStatuses: workers.map((worker) => `${worker.id}:${worker.status}:${worker.activeSessionCount}/${worker.capacity}`),
    })
    return
  }
  log.info("worker selected for new session", {
    workerId: selected.id,
    status: selected.status,
    activeSessionCount: selected.activeSessionCount,
    capacity: selected.capacity,
    readyWorkerIds: workers.map((worker) => worker.id),
  })
  return selected
}

export async function resolveStickyWorkerForSession(session: BusinessSession) {
  if (!session.workerId) return
  const worker = await workerService.findWorkerById(session.workerId)
  if (!worker) return
  if (worker.status === "offline" || worker.status === "draining") return
  if (!supportsRuntimeExecution(worker)) return
  return worker
}

export async function refreshWorkerLoad(workerId: string) {
  const worker = await workerService.findWorkerById(workerId)
  if (!worker) return
  const sessions = await sessionService.listSessions()
  const activeSessionCount = sessions.filter(
    (session) =>
      session.workerId === workerId &&
      (isWorkerReservedSession(session) ||
        session.status === "opening" ||
        session.status === "active" ||
        session.status === "waiting_input" ||
        session.status === "cancelling" ||
        session.status === "closing"),
  ).length
  const nextStatus = activeSessionCount >= worker.capacity ? "busy" : worker.status === "busy" ? "ready" : worker.status
  return workerService.touchWorker(workerId, {
    activeSessionCount,
    status: nextStatus,
  })
}

function compareWorkers(left: WorkerNode, right: WorkerNode) {
  const leftSpare = left.capacity - left.activeSessionCount
  const rightSpare = right.capacity - right.activeSessionCount
  if (leftSpare !== rightSpare) return rightSpare - leftSpare
  if (left.activeSessionCount !== right.activeSessionCount) return left.activeSessionCount - right.activeSessionCount
  return new Date(left.lastHeartbeatAt).getTime() - new Date(right.lastHeartbeatAt).getTime()
}

function supportsRuntimeExecution(worker: WorkerNode) {
  return Config.localWorkers.some((localWorker) => normalizeBaseUrl(localWorker.baseUrl) === normalizeBaseUrl(worker.baseUrl))
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "")
}

function isWorkerReservedSession(session: { status: string; updatedAt: string }) {
  if (session.status !== "created") return false
  return Date.now() - new Date(session.updatedAt).getTime() <= CREATED_SESSION_RESERVATION_MS
}
