import type { Hono } from "hono"
import {
  createEventStreamForUser,
  listPendingPermissionsForUser,
  listPendingQuestionsForUser,
  respondPermissionForUser,
  respondQuestionForUser,
} from "../../services/interaction/interaction-service"
import { permissionResponseSchema, questionResponseSchema } from "../schemas"
import { jsonError, jsonOk, requestId } from "../response"
import { requireUser, unauthorized } from "../auth-helpers"

export function registerInteractionRoutes(app: Hono) {
  app.get("/api/acp/session/permission/list", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const result = await listPendingPermissionsForUser({
      user,
      businessSessionId: c.req.query("businessSessionId") || undefined,
    })
    if (!result.ok) {
      if (result.reason === "session_not_found") {
        return c.json(jsonError("session not found", 404, reqId), 404)
      }
      if (result.reason === "workspace_not_shared") {
        return c.json(jsonError("workspace is not shared with you", 403, reqId), 403)
      }
      if (result.reason === "share_revoked") {
        return c.json(jsonError("workspace share was revoked", 403, reqId), 403)
      }
      if (result.reason === "scope_mismatch") {
        return c.json(jsonError("session is outside your scope", 403, reqId), 403)
      }
      return c.json(jsonError("forbidden", 403, reqId), 403)
    }
    return c.json(jsonOk({ items: result.items }, reqId))
  })

  app.get("/api/acp/session/question/list", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const result = await listPendingQuestionsForUser({
      user,
      businessSessionId: c.req.query("businessSessionId") || undefined,
    })
    if (!result.ok) {
      if (result.reason === "session_not_found") {
        return c.json(jsonError("session not found", 404, reqId), 404)
      }
      if (result.reason === "workspace_not_shared") {
        return c.json(jsonError("workspace is not shared with you", 403, reqId), 403)
      }
      if (result.reason === "share_revoked") {
        return c.json(jsonError("workspace share was revoked", 403, reqId), 403)
      }
      if (result.reason === "scope_mismatch") {
        return c.json(jsonError("session is outside your scope", 403, reqId), 403)
      }
      return c.json(jsonError("forbidden", 403, reqId), 403)
    }
    return c.json(jsonOk({ items: result.items }, reqId))
  })

  app.post("/api/acp/session/permission/respond", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const body = permissionResponseSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid permission payload", 400, reqId, body.error.flatten()), 400)
    }
    const result = await respondPermissionForUser({
      user,
      businessSessionId: body.data.businessSessionId,
      requestId: body.data.requestId,
      approved: body.data.approved,
      optionId: body.data.optionId,
    })
    if (!result.ok) {
      if (result.reason === "session_not_found") {
        return c.json(jsonError("session not found", 404, reqId), 404)
      }
      if (result.reason === "workspace_not_shared") {
        return c.json(jsonError("workspace is not shared with you", 403, reqId), 403)
      }
      if (result.reason === "share_revoked") {
        return c.json(jsonError("workspace share was revoked", 403, reqId), 403)
      }
      if (result.reason === "scope_mismatch") {
        return c.json(jsonError("session is outside your scope", 403, reqId), 403)
      }
      if (result.reason === "forbidden") {
        return c.json(jsonError("forbidden", 403, reqId), 403)
      }
      return c.json(jsonError("permission request not found", 404, reqId), 404)
    }
    return c.json(jsonOk({ success: true }, reqId))
  })

  app.post("/api/acp/session/question/respond", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const body = questionResponseSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid question payload", 400, reqId, body.error.flatten()), 400)
    }
    const result = await respondQuestionForUser({
      user,
      businessSessionId: body.data.businessSessionId,
      requestId: body.data.requestId,
      action: body.data.action,
      content: body.data.content as Record<string, unknown> | undefined,
    })
    if (!result.ok) {
      if (result.reason === "session_not_found") {
        return c.json(jsonError("session not found", 404, reqId), 404)
      }
      if (result.reason === "workspace_not_shared") {
        return c.json(jsonError("workspace is not shared with you", 403, reqId), 403)
      }
      if (result.reason === "share_revoked") {
        return c.json(jsonError("workspace share was revoked", 403, reqId), 403)
      }
      if (result.reason === "scope_mismatch") {
        return c.json(jsonError("session is outside your scope", 403, reqId), 403)
      }
      if (result.reason === "forbidden") {
        return c.json(jsonError("forbidden", 403, reqId), 403)
      }
      return c.json(jsonError("question request not found", 404, reqId), 404)
    }
    return c.json(jsonOk({ success: true }, reqId))
  })

  app.get("/api/acp/session/events", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const sessionId = c.req.query("businessSessionId")
    if (!sessionId) {
      return c.json(jsonError("businessSessionId is required", 400, reqId), 400)
    }

    const result = await createEventStreamForUser({
      user,
      businessSessionId: sessionId,
      afterEventId:
        c.req.query("afterEventId") ||
        c.req.header("last-event-id") ||
        c.req.header("Last-Event-ID") ||
        undefined,
      abortSignal: c.req.raw.signal,
    })
    if (!result.ok) {
      if (result.reason === "session_not_found") {
        return c.json(jsonError("session not found", 404, reqId), 404)
      }
      if (result.reason === "workspace_not_shared") {
        return c.json(jsonError("workspace is not shared with you", 403, reqId), 403)
      }
      if (result.reason === "share_revoked") {
        return c.json(jsonError("workspace share was revoked", 403, reqId), 403)
      }
      if (result.reason === "scope_mismatch") {
        return c.json(jsonError("session is outside your scope", 403, reqId), 403)
      }
      return c.json(jsonError("forbidden", 403, reqId), 403)
    }

    return new Response(result.stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    })
  })
}
