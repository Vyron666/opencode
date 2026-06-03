import { Config } from "../../config"
import { createLogger } from "../../log"
import { closeRuntime } from "../../acp-runtime-manager"
import { resetSessionRuntime } from "../session/session-lifecycle-service"
import { sessionService, workerService } from "../store/store-singleton"
import { cleanupExpiredSandboxWorkspaces, cleanupStalePreparedSandboxWorkspaces } from "../sandbox/sandbox-workspace-service"
import { markRuntimeBindingLost } from "./runtime-binding-service"
import { recordRuntimeFailure } from "./runtime-failure-service"
import { listExpiredRuntimeLeases, releaseRuntimeLease } from "./runtime-lease-service"
import { hasWorkerHeartbeat } from "./worker-heartbeat-query-service"

const log = createLogger("runtime-governance-loop")

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

export async function runRuntimeGovernanceTick() {
  await markHeartbeatExpiredWorkersOffline()
  await cleanupExpiredRuntimeLeases()
  await cleanupExpiredSandboxWorkspaces()
  await cleanupStalePreparedSandboxWorkspaces()
}

async function markHeartbeatExpiredWorkersOffline() {
  const expireBefore = new Date(Date.now() - Config.workerHeartbeatTimeoutMs).toISOString()
  const expiredWorkers = await workerService.listWorkersHeartbeatExpired(expireBefore)
  if (!expiredWorkers.length) return

  const sessions = await sessionService.listSessions()
  for (const worker of expiredWorkers) {
    if (!(await hasWorkerHeartbeat(worker.id))) continue
    if (worker.status !== "offline") {
      await workerService.touchWorker(worker.id, {
        status: "offline",
      })
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
      await recordRuntimeFailure({
        businessSessionId: session.id,
        workerId: worker.id,
        failureType: "worker_offline",
        message: "worker went offline while session was still attached",
      })
    }
  }
}

async function cleanupExpiredRuntimeLeases() {
  const expiredLeases = await listExpiredRuntimeLeases()
  for (const lease of expiredLeases) {
    const session = await sessionService.getSession(lease.businessSessionId)
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

async function closeRuntimeForGovernance(sessionId: string, reason: "worker_offline" | "lease_expired") {
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
