import * as RuntimeFailureLogRepo from "../../repos/runtime-failure-log-repo"
import * as RuntimeLeaseRepo from "../../repos/runtime-lease-repo"
import * as WorkerHeartbeatRepo from "../../repos/worker-heartbeat-repo"
import { authorizeSystemWorkersAccess } from "../access/authorization-service"
import { sessionService, workerService } from "../store/store-singleton"
import type { User } from "../../types"

export async function getWorkerHeartbeatDetailForUser(input: {
  user: User
  workerId: string
  limit?: number
}) {
  const authorization = authorizeSystemWorkersAccess(input.user)
  if (!authorization.ok) return { ok: false as const, reason: "forbidden" }
  const worker = await workerService.findWorkerById(input.workerId)
  if (!worker) return { ok: false as const, reason: "worker_not_found" }
  return {
    ok: true as const,
    worker,
    heartbeats: await WorkerHeartbeatRepo.listLatestHeartbeats(input.workerId, input.limit ?? 20),
  }
}

export async function getRuntimeLeaseDetailForUser(input: {
  user: User
  businessSessionId?: string
  limit?: number
}) {
  const authorization = authorizeSystemWorkersAccess(input.user)
  if (!authorization.ok) return { ok: false as const, reason: "forbidden" }
  if (input.businessSessionId) {
    const session = await sessionService.getSession(input.businessSessionId)
    if (!session) return { ok: false as const, reason: "session_not_found" }
    return {
      ok: true as const,
      session,
      lease: await RuntimeLeaseRepo.findLeaseBySessionId(input.businessSessionId),
    }
  }
  return {
    ok: true as const,
    leases: await RuntimeLeaseRepo.listLatestLeases(input.limit ?? 20),
  }
}

export async function getRuntimeFailureDetailForUser(input: {
  user: User
  businessSessionId?: string
  limit?: number
}) {
  const authorization = authorizeSystemWorkersAccess(input.user)
  if (!authorization.ok) return { ok: false as const, reason: "forbidden" }
  if (input.businessSessionId) {
    const session = await sessionService.getSession(input.businessSessionId)
    if (!session) return { ok: false as const, reason: "session_not_found" }
    return {
      ok: true as const,
      session,
      failures: await RuntimeFailureLogRepo.listRecentRuntimeFailuresBySession(input.businessSessionId, input.limit ?? 20),
    }
  }
  return {
    ok: true as const,
    failures: await RuntimeFailureLogRepo.listRecentRuntimeFailures(input.limit ?? 20),
  }
}
