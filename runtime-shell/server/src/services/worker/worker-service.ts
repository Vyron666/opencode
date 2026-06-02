import { authorizeSystemWorkersAccess } from "../access/authorization-service"
import { recordWorkerHeartbeat } from "../runtime-governance/worker-heartbeat-service"
import { workerService } from "../store/store-singleton"
import type { User } from "../../types"

export async function registerWorkerForUser(input: {
  user: User
  workerId?: string
  tenantId?: string
  organizationId?: string
  nodeCode: string
  endpoint: string
  version?: string
  capacityTotal: number
  name?: string
}) {
  const authorization = authorizeSystemWorkersAccess(input.user)
  if (!authorization.ok) return { ok: false as const, reason: "forbidden" }
  const worker = await workerService.registerWorker({
    workerId: input.workerId,
    tenantId: input.tenantId ?? input.user.tenantId,
    organizationId: input.organizationId ?? input.user.organizationId,
    workerCode: input.nodeCode,
    name: input.name || input.nodeCode,
    baseUrl: input.endpoint,
    capacity: input.capacityTotal,
    version: input.version,
  })
  if (!worker) return { ok: false as const, reason: "register_failed" }
  return { ok: true as const, worker }
}

export async function heartbeatWorkerForUser(input: {
  user: User
  workerNodeId: string
  capacityUsed: number
  status: "registering" | "ready" | "busy" | "degraded" | "offline" | "draining"
}) {
  const authorization = authorizeSystemWorkersAccess(input.user)
  if (!authorization.ok) return { ok: false as const, reason: "forbidden" }
  const worker = await workerService.findWorkerById(input.workerNodeId)
  if (!worker) return { ok: false as const, reason: "worker_not_found" }
  if (
    worker.tenantId &&
    worker.organizationId &&
    (worker.tenantId !== input.user.tenantId || worker.organizationId !== input.user.organizationId)
  ) {
    return { ok: false as const, reason: "forbidden" }
  }
  await recordWorkerHeartbeat({
    workerId: input.workerNodeId,
    capacityUsed: input.capacityUsed,
    status: input.status,
  })
  const updated = await workerService.reportWorkerHeartbeat(input.workerNodeId, {
    activeSessionCount: input.capacityUsed,
    status: input.status,
  })
  if (!updated) return { ok: false as const, reason: "worker_not_found" }
  return { ok: true as const, worker: updated }
}
