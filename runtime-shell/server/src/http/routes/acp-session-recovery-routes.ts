import type { Hono } from "hono"
import {
  recoverSessionForUser,
  rebindSessionForUser,
} from "../../services/runtime-governance/runtime-recovery-service"
import { sessionRebindSchema, sessionRecoverSchema } from "../schemas"
import { jsonError, jsonOk, requestId } from "../response"
import { requireUser, unauthorized } from "../auth-helpers"
import {
  isRuntimeWorkspaceReason,
  isSharedSessionAccessReason,
  mapRuntimeWorkspaceError,
  mapSharedSessionAccessError,
} from "./acp-session-route-support"

export function registerAcpSessionRecoveryRoutes(app: Hono) {
  app.post("/api/acp/session/recover", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const body = sessionRecoverSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid recover payload", 400, reqId, body.error.flatten()), 400)
    }

    const result = await recoverSessionForUser({
      user,
      businessSessionId: body.data.businessSessionId,
    })
    if (!result.ok) {
      if (result.reason === "session_not_found") return c.json(jsonError("session not found", 404, reqId), 404)
      if (isRuntimeWorkspaceReason(result.reason)) {
        const mapped = mapRuntimeWorkspaceError(result.reason, reqId)
        return c.json(mapped.body, mapped.status)
      }
      if (isSharedSessionAccessReason(result.reason)) {
        const mapped = mapSharedSessionAccessError(result.reason, reqId)
        return c.json(mapped.body, mapped.status)
      }
      if (result.reason === "invalid_session_status") {
        return c.json(jsonError("session does not need manual recovery right now", 409, reqId), 409)
      }
      return c.json(jsonError("forbidden", 403, reqId), 403)
    }

    return c.json(jsonOk(result.session, reqId))
  })

  app.post("/api/acp/session/rebind", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const body = sessionRebindSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid rebind payload", 400, reqId, body.error.flatten()), 400)
    }

    const result = await rebindSessionForUser({
      user,
      businessSessionId: body.data.businessSessionId,
      reason: body.data.reason,
    })
    if (!result.ok) {
      if (result.reason === "session_not_found") return c.json(jsonError("session not found", 404, reqId), 404)
      if (result.reason === "worker_not_found") {
        return c.json(jsonError("no available worker can restore this session right now", 503, reqId), 503)
      }
      if (result.reason === "invalid_session_status") {
        return c.json(jsonError("session does not support manual rebind right now", 409, reqId), 409)
      }
      return c.json(jsonError("forbidden", 403, reqId), 403)
    }

    return c.json(
      jsonOk(
        {
          session: result.session,
          binding: result.binding,
        },
        reqId,
      ),
    )
  })
}
