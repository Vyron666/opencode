import { Config } from "../../config"
import type { BusinessSession, User, WorkerNode } from "../../types"
import { sessionService, workerService } from "../store/store-singleton"

const CREATED_SESSION_RESERVATION_MS = 30000

export async function selectWorkerForNewSession(user: User) {
  const workers = await workerService.listReadyWorkersForUser(user)
  if (!workers.length) return
  const sessions = await sessionService.listSessions()
  return workers
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
    .filter((worker) => worker.activeSessionCount < worker.capacity)
    .sort(compareWorkers)[0]
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
