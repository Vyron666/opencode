import type { Hono } from "hono"
import { cleanupRuntimeGovernanceForUser } from "../../services/runtime-governance/runtime-recovery-service"
import {
  getRuntimeFailureDetailForUser,
  getRuntimeDetailForUser,
  getRuntimeLeaseDetailForUser,
  getWorkerHeartbeatDetailForUser,
} from "../../services/system/runtime-governance-query-service"
import { heartbeatWorkerForUser, registerWorkerForUser } from "../../services/worker/worker-service"
import { getHealthOverview, getWorkerOverviewForUser } from "../../services/system/system-service"
import { workerHeartbeatSchema, workerRegisterSchema } from "../schemas"
import { jsonError, jsonOk, requestId } from "../response"
import { requireUser, unauthorized } from "../auth-helpers"

export function registerSystemRoutes(app: Hono) {
  app.get("/healthz", async (c) => {
    const reqId = requestId(c)
    return c.json(jsonOk(await getHealthOverview(), reqId))
  })

  app.get("/api/worker/list", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const result = await getWorkerOverviewForUser(user)
    if (!result.ok) {
      return c.json(jsonError("forbidden", 403, reqId), 403)
    }
    return c.json(jsonOk({ items: result.items, opencode: result.opencode }, reqId))
  })

  app.post("/api/worker/register", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const body = workerRegisterSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid worker register payload", 400, reqId, body.error.flatten()), 400)
    }
    const result = await registerWorkerForUser({
      user,
      tenantId: body.data.tenantId,
      organizationId: body.data.organizationId,
      nodeCode: body.data.nodeCode,
      endpoint: body.data.endpoint,
      version: body.data.version,
      capacityTotal: body.data.capacityTotal,
      name: body.data.name,
    })
    if (!result.ok) {
      if (result.reason === "forbidden") {
        return c.json(jsonError("forbidden", 403, reqId), 403)
      }
      return c.json(jsonError("failed to register worker", 500, reqId), 500)
    }
    return c.json(
      jsonOk(
        {
          workerNodeId: result.worker.id,
          status: result.worker.status,
        },
        reqId,
      ),
    )
  })

  app.post("/api/worker/heartbeat", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const body = workerHeartbeatSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid worker heartbeat payload", 400, reqId, body.error.flatten()), 400)
    }
    const result = await heartbeatWorkerForUser({
      user,
      workerNodeId: body.data.workerNodeId,
      capacityUsed: body.data.capacityUsed,
      status: body.data.status,
    })
    if (!result.ok) {
      if (result.reason === "forbidden") {
        return c.json(jsonError("forbidden", 403, reqId), 403)
      }
      if (result.reason === "worker_not_found") {
        return c.json(jsonError("worker not found", 404, reqId), 404)
      }
      return c.json(jsonError("failed to update worker heartbeat", 500, reqId), 500)
    }
    return c.json(jsonOk({ worker: result.worker }, reqId))
  })

  app.post("/api/runtime-governance/cleanup", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const result = await cleanupRuntimeGovernanceForUser(user)
    if (!result.ok) {
      return c.json(jsonError("forbidden", 403, reqId), 403)
    }
    return c.json(jsonOk({ cleanedSessionIds: result.cleanedSessionIds }, reqId))
  })

  app.get("/api/runtime-governance/heartbeat/detail", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const workerId = c.req.query("workerId")
    if (!workerId) {
      return c.json(jsonError("workerId is required", 400, reqId), 400)
    }
    const limit = Number(c.req.query("limit") || "20")
    const result = await getWorkerHeartbeatDetailForUser({
      user,
      workerId,
      limit,
    })
    if (!result.ok) {
      if (result.reason === "worker_not_found") {
        return c.json(jsonError("worker not found", 404, reqId), 404)
      }
      return c.json(jsonError("forbidden", 403, reqId), 403)
    }
    return c.json(jsonOk({ worker: result.worker, heartbeats: result.heartbeats, remoteHeartbeat: result.remoteHeartbeat }, reqId))
  })

  app.get("/api/runtime-governance/runtime/detail", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const businessSessionId = c.req.query("businessSessionId")
    if (!businessSessionId) {
      return c.json(jsonError("businessSessionId is required", 400, reqId), 400)
    }
    const result = await getRuntimeDetailForUser({
      user,
      businessSessionId,
    })
    if (!result.ok) {
      if (result.reason === "session_not_found") {
        return c.json(jsonError("session not found", 404, reqId), 404)
      }
      return c.json(jsonError("forbidden", 403, reqId), 403)
    }
    return c.json(
      jsonOk({
        session: result.session,
        binding: result.binding,
        lease: result.lease,
        failures: result.failures,
        remoteRuntime: result.remoteRuntime,
        remoteLease: result.remoteLease,
        remoteFailure: result.remoteFailure,
      }, reqId),
    )
  })

  app.get("/api/runtime-governance/lease/detail", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const businessSessionId = c.req.query("businessSessionId") || undefined
    const limit = Number(c.req.query("limit") || "20")
    const result = await getRuntimeLeaseDetailForUser({
      user,
      businessSessionId,
      limit,
    })
    if (!result.ok) {
      if (result.reason === "session_not_found") {
        return c.json(jsonError("session not found", 404, reqId), 404)
      }
      return c.json(jsonError("forbidden", 403, reqId), 403)
    }
    if ("lease" in result) {
      return c.json(jsonOk({
        session: result.session,
        lease: result.lease,
        remoteLease: result.remoteLease,
        remoteRuntime: result.remoteRuntime,
      }, reqId))
    }
    return c.json(jsonOk({ leases: result.leases }, reqId))
  })

  app.get("/api/runtime-governance/failure/detail", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const businessSessionId = c.req.query("businessSessionId") || undefined
    const limit = Number(c.req.query("limit") || "20")
    const result = await getRuntimeFailureDetailForUser({
      user,
      businessSessionId,
      limit,
    })
    if (!result.ok) {
      if (result.reason === "session_not_found") {
        return c.json(jsonError("session not found", 404, reqId), 404)
      }
      return c.json(jsonError("forbidden", 403, reqId), 403)
    }
    if ("session" in result) {
      return c.json(jsonOk({
        session: result.session,
        failures: result.failures,
        remoteFailure: result.remoteFailure,
        remoteRuntime: result.remoteRuntime,
      }, reqId))
    }
    return c.json(jsonOk({ failures: result.failures }, reqId))
  })
}
