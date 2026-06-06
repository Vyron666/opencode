import { Config } from "../../config"
import { createConcurrencyGate } from "../../lib/concurrency-gate"
import { createLogger } from "../../log"
import * as RuntimeOperationQueueRepo from "../../repos/runtime-operation-queue-repo"
import * as SandboxInstanceRepo from "../../repos/sandbox-instance-repo"
import type { BusinessSession, User, WorkerNode } from "../../types"
import { sessionService, workerService } from "../store/store-singleton"
import { refreshLocalWorkersNow } from "../worker/local-worker-heartbeat-loop"

const CREATED_SESSION_RESERVATION_MS = 30000
const log = createLogger("scheduler-service")
const pendingWorkerSelections = new Map<string, {
  workerId: string
  workspaceId?: string
}>()
const runWithWorkerSelectionGate = createConcurrencyGate(1)
let workerSelectionCursor = 0

export async function selectWorkerForNewSession(
  user: User,
  excludedWorkerIds: string[] = [],
  reservationId?: string,
  workspaceId?: string,
) {
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
  return runWithWorkerSelectionGate(async () => {
    const sessions = await sessionService.listSessionsByFilter({
      tenantId: user.tenantId,
      organizationId: user.organizationId,
      statuses: ["created", "opening", "active", "waiting_input", "cancelling", "closing", "orphaned"],
    })
    const pinnedWorkspaceWorker = await resolveWorkspacePinnedWorker({
      sessions,
      workspaceId,
      excludedWorkerIds: excluded,
      currentReservationId: reservationId,
    })
    if (pinnedWorkspaceWorker) {
      if (reservationId) {
        pendingWorkerSelections.set(reservationId, {
          workerId: pinnedWorkspaceWorker.id,
          workspaceId,
        })
      }
      log.info("worker selected from workspace pin", {
        workerId: pinnedWorkspaceWorker.id,
        workspaceId,
      })
      return pinnedWorkspaceWorker
    }
    const pendingSelectionCounts = buildPendingSelectionCounts(reservationId)
    const candidates = (await Promise.all(
      workers.map(async (worker) => {
        const activeSessionCount = sessions.filter(
          (session) =>
            session.workerId === worker.id &&
            (isWorkerReservedSession(session) ||
              session.status === "opening" ||
              session.status === "active" ||
              session.status === "waiting_input" ||
              session.status === "cancelling" ||
              session.status === "closing"),
        ).length
        const [runningSandboxCount, queuedOperationCount] = await Promise.all([
          SandboxInstanceRepo.countBusinessSandboxInstancesByWorkerStatus(worker.id, ["preparing", "ready", "running"]),
          RuntimeOperationQueueRepo.countRuntimeOperationsByScope({
            tenantId: user.tenantId,
            organizationId: user.organizationId,
            workerId: worker.id,
            statuses: ["queued", "running"],
          }),
        ])
        return {
          ...worker,
          // 中文/English: reserve worker choice inside one narrow critical window so
          // concurrent opens stop observing the same pre-reservation worker snapshot.
          activeSessionCount: activeSessionCount + (pendingSelectionCounts.get(worker.id) ?? 0),
          resourceSummary: {
            runningSandboxCount,
            warmSandboxCount: worker.resourceSummary?.warmSandboxCount ?? worker.warmPoolReady ?? 0,
            queuedOperationCount,
            cpuPercent: worker.resourceSummary?.cpuPercent,
            memoryBytes: worker.resourceSummary?.memoryBytes,
            diskBytes: worker.resourceSummary?.diskBytes,
          },
        }
      }),
    ))
      .filter((worker) => supportsRuntimeExecution(worker))
      .filter((worker) => !excluded.has(worker.id))
      .filter((worker) => worker.activeSessionCount < worker.capacity)
    const selected = pickWorkerWithRoundRobin(candidates)
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
      workspaceId,
    })
    if (reservationId) {
      pendingWorkerSelections.set(reservationId, {
        workerId: selected.id,
        workspaceId,
      })
    }
    return selected
  })
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
  const sessions = await sessionService.listSessionsByFilter({
    workerId,
    statuses: ["created", "opening", "active", "waiting_input", "cancelling", "closing"],
  })
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

export function releaseWorkerSelectionReservation(reservationId: string) {
  pendingWorkerSelections.delete(reservationId)
}

async function resolveWorkspacePinnedWorker(input: {
  sessions: BusinessSession[]
  workspaceId?: string
  excludedWorkerIds: Set<string>
  currentReservationId?: string
}) {
  if (!input.workspaceId) return
  const reservedWorkerId = [...pendingWorkerSelections.entries()]
    .find(([reservationId, value]) =>
      reservationId !== input.currentReservationId &&
      value.workspaceId === input.workspaceId &&
      !input.excludedWorkerIds.has(value.workerId),
    )?.[1].workerId
  if (reservedWorkerId) {
    const worker = await workerService.findWorkerById(reservedWorkerId)
    if (worker && worker.status !== "offline" && worker.status !== "draining" && supportsRuntimeExecution(worker)) {
      return worker
    }
  }

  const pinnedSession = input.sessions.find((session) =>
    session.workspaceId === input.workspaceId &&
    !input.excludedWorkerIds.has(session.workerId) &&
    Boolean(session.workerId) &&
    (
      isWorkerReservedSession(session) ||
      session.status === "opening" ||
      session.status === "active" ||
      session.status === "waiting_input" ||
      session.status === "cancelling" ||
      session.status === "closing" ||
      session.status === "orphaned"
    ),
  )
  if (!pinnedSession?.workerId) return
  const worker = await workerService.findWorkerById(pinnedSession.workerId)
  if (!worker) return
  if (worker.status === "offline" || worker.status === "draining") return
  if (!supportsRuntimeExecution(worker)) return
  return worker
}

function compareWorkers(left: WorkerNode, right: WorkerNode) {
  if (left.activeSessionCount !== right.activeSessionCount) {
    return left.activeSessionCount - right.activeSessionCount
  }
  const leftRunningSandboxes = left.resourceSummary?.runningSandboxCount ?? left.activeSessionCount
  const rightRunningSandboxes = right.resourceSummary?.runningSandboxCount ?? right.activeSessionCount
  if (leftRunningSandboxes !== rightRunningSandboxes) return leftRunningSandboxes - rightRunningSandboxes
  const leftQueue = left.resourceSummary?.queuedOperationCount ?? 0
  const rightQueue = right.resourceSummary?.queuedOperationCount ?? 0
  if (leftQueue !== rightQueue) return leftQueue - rightQueue
  const leftWarmRuntimeSpare = readWarmRuntimeSpare(left)
  const rightWarmRuntimeSpare = readWarmRuntimeSpare(right)
  // 中文/English: warm spare is only a tie-breaker. Prioritizing it before load
  // can hotspot one worker during bursts and turn warm hits into agent timeouts.
  if (leftWarmRuntimeSpare !== rightWarmRuntimeSpare) return rightWarmRuntimeSpare - leftWarmRuntimeSpare
  const leftSpare = left.capacity - left.activeSessionCount
  const rightSpare = right.capacity - right.activeSessionCount
  if (leftSpare !== rightSpare) return rightSpare - leftSpare
  return 0
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

function buildPendingSelectionCounts(currentReservationId?: string) {
  const counts = new Map<string, number>()
  for (const [reservationId, selection] of pendingWorkerSelections.entries()) {
    if (reservationId === currentReservationId) continue
    counts.set(selection.workerId, (counts.get(selection.workerId) ?? 0) + 1)
  }
  return counts
}

function pickWorkerWithRoundRobin(candidates: WorkerNode[]) {
  if (!candidates.length) return
  const ranked = [...candidates].sort(compareWorkers)
  const best = ranked[0]
  if (!best) return
  const equivalent = ranked.filter((candidate) => isWorkerPressureEquivalent(candidate, best))
  if (equivalent.length === 1) return best
  const ordered = [...equivalent].sort((left, right) => left.id.localeCompare(right.id))
  // 中文/English: rotate close-pressure workers so light queue jitter does not pin
  // burst traffic to the same worker for an extended period.
  const selected = ordered[workerSelectionCursor % ordered.length]
  workerSelectionCursor = (workerSelectionCursor + 1) % Number.MAX_SAFE_INTEGER
  return selected
}

function isWorkerPressureEquivalent(left: WorkerNode, right: WorkerNode) {
  if (Math.abs(readWarmRuntimeSpare(left) - readWarmRuntimeSpare(right)) > 0) return false
  if (left.activeSessionCount !== right.activeSessionCount) return false
  const leftRunningSandboxes = left.resourceSummary?.runningSandboxCount ?? left.activeSessionCount
  const rightRunningSandboxes = right.resourceSummary?.runningSandboxCount ?? right.activeSessionCount
  if (Math.abs(leftRunningSandboxes - rightRunningSandboxes) > 1) return false
  const leftQueue = left.resourceSummary?.queuedOperationCount ?? 0
  const rightQueue = right.resourceSummary?.queuedOperationCount ?? 0
  if (Math.abs(leftQueue - rightQueue) > 1) return false
  const leftSpare = left.capacity - left.activeSessionCount
  const rightSpare = right.capacity - right.activeSessionCount
  return Math.abs(leftSpare - rightSpare) <= 1
}

function readWarmRuntimeSpare(worker: WorkerNode) {
  // 中文/English: warmPoolReady already counts only unleased materialized runtimes.
  // Active sessions are excluded by the worker snapshot, so subtracting them here
  // double-counts load and hides real warm capacity from scheduling.
  return Math.max(0, worker.warmPoolReady ?? 0)
}
