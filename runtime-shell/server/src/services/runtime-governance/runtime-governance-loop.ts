import { Config } from "../../config"
import { createLogger } from "../../log"
import { listRecentRuntimeFailuresBySession } from "../../repos/runtime-failure-log-repo"
import * as RuntimeOperationQueueRepo from "../../repos/runtime-operation-queue-repo"
import { closeRuntime, getRuntime } from "../../acp-runtime-manager"
import { resetSessionRuntime } from "../session/session-lifecycle-service"
import { sessionService, workerService } from "../store/store-singleton"
import {
  cleanupClosedSandboxWorkspace,
  cleanupExpiredSandboxWorkspaces,
  cleanupStaleInactiveSandboxInstances,
  cleanupStalePreparedSandboxWorkspaces,
  closeSandboxWorkspace,
} from "../sandbox/sandbox-workspace-service"
import { markRuntimeBindingLost } from "./runtime-binding-service"
import { recordRuntimeFailure } from "./runtime-failure-service"
import { listExpiredRuntimeLeases, releaseRuntimeLease, renewRuntimeLeaseForSession } from "./runtime-lease-service"
import { hasWorkerHeartbeat } from "./worker-heartbeat-query-service"
import type { RuntimeOperationQueueItem } from "../../types"

const log = createLogger("runtime-governance-loop")
const STALE_CLOSING_SESSION_MS = 60 * 1000
const STALE_QUEUED_RUNTIME_OPERATION_MS = 10 * 60 * 1000
const STALE_RUNNING_RUNTIME_OPERATION_MS = 10 * 60 * 1000
const STALE_PROMPT_RUNTIME_OPERATION_MS = Math.max(Config.runtimeLeaseDurationMs, 15 * 60 * 1000)

let runtimeGovernanceTimer: Timer | undefined

export function startRuntimeGovernanceLoop() {
  if (runtimeGovernanceTimer) return
  runtimeGovernanceTimer = setInterval(() => {
    void runRuntimeGovernanceTick().catch((error) => {
      log.error("runtime governance tick failed", {
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }, Config.runtimeGovernanceIntervalMs)
}

export function stopRuntimeGovernanceLoop() {
  if (!runtimeGovernanceTimer) return
  clearInterval(runtimeGovernanceTimer)
  runtimeGovernanceTimer = undefined
}

export async function runRuntimeGovernanceTick() {
  await markHeartbeatExpiredWorkersOffline()
  await cleanupStaleClosingSessions()
  await cleanupStaleRuntimeOperations()
  await cleanupExpiredRuntimeLeases()
  await cleanupExpiredSandboxWorkspaces()
  await cleanupStalePreparedSandboxWorkspaces()
  await cleanupStaleInactiveSandboxInstances()
}

async function markHeartbeatExpiredWorkersOffline() {
  const expireBefore = new Date(Date.now() - Config.workerHeartbeatTimeoutMs).toISOString()
  const expiredWorkers = await workerService.listWorkersHeartbeatExpired(expireBefore)
  if (!expiredWorkers.length) return

  const expiredWorkerIds = expiredWorkers.map((worker) => worker.id)
  const sessions = await sessionService.listSessionsByFilter({
    workerIds: expiredWorkerIds,
    statuses: ["active", "waiting_input", "opening", "orphaned"],
  })
  for (const worker of expiredWorkers) {
    if (!(await hasWorkerHeartbeat(worker.id))) continue
    const markedOffline = await workerService.markWorkerOfflineIfHeartbeatExpired(worker.id, expireBefore)
    if (!markedOffline) continue
    if (worker.status !== "offline") {
      await recordRuntimeFailure({
        workerId: worker.id,
        failureType: "worker_offline",
        message: "worker heartbeat timed out",
        detail: { lastHeartbeatAt: worker.lastHeartbeatAt },
      })
    }
    const affectedSessions = sessions.filter(
      (session) =>
        session.workerId === worker.id &&
        (session.status === "active" || session.status === "waiting_input" || session.status === "opening"),
    )
    for (const session of affectedSessions) {
      // 中文/English: once the worker heartbeat is judged offline, the stale runtime
      // process must be closed too; otherwise reopen can accidentally reuse a detached
      // in-memory runtime and return to active without rebuilding binding/lease state.
      await closeRuntimeForGovernance(session.id, "worker_offline")
      await markRuntimeBindingLost(session.id)
      await resetSessionRuntime(session.id, "orphaned")
    }
    const impactedSessions = sessions.filter(
      (session) =>
        session.workerId === worker.id &&
        (session.status === "active"
          || session.status === "waiting_input"
          || session.status === "opening"
          || session.status === "orphaned"),
    )
    for (const session of impactedSessions) {
      if (await hasRecordedWorkerOfflineFailure(session.id)) continue
      await recordRuntimeFailure({
        businessSessionId: session.id,
        workerId: worker.id,
        failureType: "worker_offline",
        // 中文/English: governance must persist the worker-offline cause even if
        // another runtime-exit path already moved the session into orphaned.
        message: "worker went offline while session was still attached",
      })
    }
  }
}

async function cleanupExpiredRuntimeLeases() {
  const expiredLeases = await listExpiredRuntimeLeases()
  for (const lease of expiredLeases) {
    const session = await sessionService.getSession(lease.businessSessionId)
    if (session && shouldKeepSessionLeaseAlive(session)) {
      // 中文/English: a healthy interactive session should not be orphaned merely
      // because lease renewal lagged for a period while the frontend reconnects.
      await renewExpiredLeaseBestEffort(session.id)
      continue
    }
    // 中文/English: lease expiry means the current runtime ownership is no longer
    // trusted, so close any live runtime before clearing persisted ownership metadata.
    await closeRuntimeForGovernance(lease.businessSessionId, "lease_expired")
    await releaseRuntimeLease(lease.businessSessionId)
    await markRuntimeBindingLost(lease.businessSessionId)
    if (session && (session.status === "active" || session.status === "waiting_input" || session.status === "opening")) {
      await resetSessionRuntime(session.id, "orphaned")
    }
    await recordRuntimeFailure({
      businessSessionId: lease.businessSessionId,
      workerId: lease.workerId,
      failureType: "binding_conflict",
      message: "runtime lease expired and runtime ownership was cleared",
      detail: {
        leaseOwner: lease.leaseOwner,
        leaseExpiresAt: lease.leaseExpiresAt,
      },
    })
  }
}

async function closeRuntimeForGovernance(
  sessionId: string,
  reason: "worker_offline" | "lease_expired" | "close_expired",
) {
  try {
    await closeRuntime(sessionId)
  } catch (error) {
    log.warn("best effort runtime close failed during governance", {
      businessSessionId: sessionId,
      reason,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function shouldKeepSessionLeaseAlive(session: NonNullable<Awaited<ReturnType<typeof sessionService.getSession>>>) {
  if (!session.binding?.runtimeKey || !session.workerId) return false
  if (hasRecentClientPresence(session)) return true
  return session.status === "active" || session.status === "waiting_input" || session.status === "cancelling"
}

async function renewExpiredLeaseBestEffort(sessionId: string) {
  try {
    await renewRuntimeLeaseForSession(sessionId)
  } catch (error) {
    log.warn("failed to renew expired runtime lease in governance", {
      businessSessionId: sessionId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function hasRecentClientPresence(session: NonNullable<Awaited<ReturnType<typeof sessionService.getSession>>>) {
  if ((session.clientConnectedCount || 0) > 0) return true
  const lastSeenAt = session.lastClientSeenAt || session.lastClientDisconnectedAt
  if (!lastSeenAt) return false
  return Date.now() - new Date(lastSeenAt).getTime() < Config.sessionClientPresenceGraceMs
}

async function hasRecordedWorkerOfflineFailure(sessionId: string) {
  const failures = await listRecentRuntimeFailuresBySession(sessionId, 20)
  return failures.some((failure) => failure.failureType === "worker_offline")
}

async function cleanupStaleClosingSessions() {
  const sessions = await sessionService.listSessionsByFilter({
    statuses: ["closing"],
  })
  for (const session of sessions) {
    if (session.status !== "closing") continue
    if (Date.now() - new Date(session.updatedAt).getTime() < STALE_CLOSING_SESSION_MS) continue
    // 中文/English: a close that stayed in `closing` this long has already lost its
    // normal completion edge, so governance must finish the sandbox/session teardown.
    await closeRuntimeForGovernance(session.id, "close_expired")
    await resetSessionRuntime(session.id, "completed")
    await closeSandboxWorkspace(session.id)
    await cleanupClosedSandboxWorkspace(session.id)
    log.warn("stale closing session cleaned", {
      businessSessionId: session.id,
      workerId: session.workerId,
      workspaceId: session.workspaceId,
    })
  }
}

async function cleanupStaleRuntimeOperations(limit = 100) {
  const operations = await RuntimeOperationQueueRepo.listStaleRuntimeOperations({
    limit,
    queuedBefore: new Date(Date.now() - STALE_QUEUED_RUNTIME_OPERATION_MS).toISOString(),
    runningBefore: new Date(Date.now() - STALE_RUNNING_RUNTIME_OPERATION_MS).toISOString(),
  })
  for (const operation of operations) {
    if (!(await shouldFailStaleRuntimeOperation(operation))) continue
    const cleaned = await RuntimeOperationQueueRepo.failRuntimeOperationIfStatusMatches({
      id: operation.id,
      statuses: [operation.status],
      updatedAt: new Date().toISOString(),
      errorMessage: readStaleRuntimeOperationMessage(operation),
      detail: {
        cleanupReason: "runtime_governance_stale_operation",
      },
    })
    if (!cleaned) continue
    log.warn("stale runtime operation cleaned", {
      operationId: operation.id,
      operationType: operation.operationType,
      status: operation.status,
      businessSessionId: operation.businessSessionId,
      workerId: operation.workerId,
    })
  }
}

async function shouldFailStaleRuntimeOperation(operation: RuntimeOperationQueueItem) {
  if (operation.status === "queued") {
    return shouldFailQueuedRuntimeOperation(operation)
  }
  return shouldFailRunningRuntimeOperation(operation)
}

async function shouldFailQueuedRuntimeOperation(operation: RuntimeOperationQueueItem) {
  if (!operation.businessSessionId) return true
  const session = await sessionService.getSession(operation.businessSessionId)
  if (!session) return true
  if (
    session.status === "completed" ||
    session.status === "failed" ||
    session.status === "orphaned"
  ) return true
  if (session.status === "closing") return operation.operationType !== "session_prompt"
  return false
}

async function shouldFailRunningRuntimeOperation(operation: RuntimeOperationQueueItem) {
  const operationAgeMs = Date.now() - new Date(operation.startedAt || operation.updatedAt).getTime()
  if (operation.operationType === "session_prompt") {
    return shouldFailRunningPromptOperation(operation, operationAgeMs)
  }
  if (!operation.businessSessionId) return true
  const session = await sessionService.getSession(operation.businessSessionId)
  if (!session) return true
  if (
    session.status === "completed" ||
    session.status === "failed" ||
    session.status === "orphaned" ||
    session.status === "created"
  ) return true
  if (session.status === "active" || session.status === "waiting_input" || session.status === "closing") {
    // 中文/English: open/load/resume/diff operations should have finished before the
    // session settles into a stable interactive state; staying running here means the
    // queue record is stale even if the session itself survived.
    return true
  }
  if (!operation.workerId) return false
  const worker = await workerService.findWorkerById(operation.workerId)
  if (!worker || worker.status === "offline") return true
  if (!(await hasWorkerHeartbeat(worker.id))) return true
  return false
}

async function shouldFailRunningPromptOperation(operation: RuntimeOperationQueueItem, operationAgeMs: number) {
  if (!operation.businessSessionId) return true
  const session = await sessionService.getSession(operation.businessSessionId)
  if (!session) return true
  if (
    session.status === "completed" ||
    session.status === "failed" ||
    session.status === "orphaned" ||
    session.status === "created"
  ) return true
  const runtime = getRuntime(operation.businessSessionId)
  if (runtime?.client.hasActivePrompt()) return false
  if (session.status !== "waiting_input" && session.status !== "cancelling") return true
  if (operationAgeMs < STALE_PROMPT_RUNTIME_OPERATION_MS) return false
  if (!operation.workerId) return true
  const worker = await workerService.findWorkerById(operation.workerId)
  if (!worker || worker.status === "offline") return true
  if (!(await hasWorkerHeartbeat(worker.id))) return true
  return true
}

function readStaleRuntimeOperationMessage(operation: RuntimeOperationQueueItem) {
  if (operation.status === "queued") return "runtime operation queued state expired during governance cleanup"
  return "runtime operation running state expired during governance cleanup"
}
