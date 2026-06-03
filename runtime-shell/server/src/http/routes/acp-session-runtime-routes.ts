import type { Hono } from "hono"
import {
  cancelPromptForUser,
  forkSessionRuntimeForUser,
  loadSessionRuntimeForUser,
  resumeSessionRuntimeForUser,
  submitPromptForUser,
} from "../../services/runtime/runtime-session-service"
import { forkSessionSchema, inputSchema, sessionIdSchema } from "../schemas"
import { jsonError, jsonOk, requestId } from "../response"
import { requireUser, unauthorized } from "../auth-helpers"
import {
  isRuntimeWorkspaceReason,
  isSharedSessionAccessReason,
  mapRuntimeWorkspaceError,
  mapSharedSessionAccessError,
} from "./acp-session-route-support"
import { replyRuntimeSessionError, replySharedSessionError } from "./acp-session-route-helpers"

export function registerAcpSessionRuntimeRoutes(app: Hono) {
  app.post("/api/acp/session/load", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const body = sessionIdSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid load payload", 400, reqId, body.error.flatten()), 400)
    }

    const result = await loadSessionRuntimeForUser({
      user,
      businessSessionId: body.data.businessSessionId,
    })
    if (!result.ok) return replyRuntimeSessionError(c, reqId, result.reason)
    return c.json(jsonOk(result.session, reqId))
  })

  app.post("/api/acp/session/resume", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const body = sessionIdSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid resume payload", 400, reqId, body.error.flatten()), 400)
    }

    const result = await resumeSessionRuntimeForUser({
      user,
      businessSessionId: body.data.businessSessionId,
    })
    if (!result.ok) return replyRuntimeSessionError(c, reqId, result.reason)
    return c.json(jsonOk(result.session, reqId))
  })

  app.post("/api/acp/session/fork", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const body = forkSessionSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid fork payload", 400, reqId, body.error.flatten()), 400)
    }

    const result = await forkSessionRuntimeForUser({
      user,
      businessSessionId: body.data.businessSessionId,
      title: body.data.title,
    })
    if (!result.ok) return replySharedSessionError(c, reqId, result.reason)
    return c.json(jsonOk(result.session, reqId))
  })

  app.post("/api/acp/session/input", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const body = inputSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid input payload", 400, reqId, body.error.flatten()), 400)
    }

    const result = await submitPromptForUser({
      user,
      requestId: reqId,
      businessSessionId: body.data.businessSessionId,
      parts: body.data.parts,
    })
    if (!result.ok) {
      if (result.reason === "quota_exceeded") return c.json(jsonError("quota exceeded", 429, reqId), 429)
      if (result.reason === "session_not_found") return c.json(jsonError("session not found", 404, reqId), 404)
      if (isRuntimeWorkspaceReason(result.reason)) {
        const mapped = mapRuntimeWorkspaceError(result.reason, reqId)
        return c.json(mapped.body, mapped.status)
      }
      if (isSharedSessionAccessReason(result.reason)) {
        const mapped = mapSharedSessionAccessError(result.reason, reqId)
        return c.json(mapped.body, mapped.status)
      }
      return c.json(jsonError("session is not ready for input right now", 409, reqId), 409)
    }

    return c.json(jsonOk({ accepted: true }, reqId))
  })

  app.post("/api/acp/session/cancel", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const body = sessionIdSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid cancel payload", 400, reqId, body.error.flatten()), 400)
    }

    const result = await cancelPromptForUser({
      user,
      requestId: reqId,
      businessSessionId: body.data.businessSessionId,
    })
    if (!result.ok) {
      if (result.reason === "session_not_found") return c.json(jsonError("session not found", 404, reqId), 404)
      if (isSharedSessionAccessReason(result.reason)) {
        const mapped = mapSharedSessionAccessError(result.reason, reqId)
        return c.json(mapped.body, mapped.status)
      }
      return c.json(jsonError("session does not have an active prompt to cancel", 409, reqId), 409)
    }

    return c.json(jsonOk({ success: true }, reqId))
  })
}
