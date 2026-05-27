import type { Hono } from "hono"
import {
  closeSessionForUser,
  createSessionForUser,
  getSessionDetailForUser,
  listUserSessionOverview,
  openSessionForUser,
} from "../../services/session/session-application-service"
import { createSessionSchema, sessionIdSchema } from "../schemas"
import { jsonError, jsonOk, requestId } from "../response"
import { requireUser, unauthorized } from "../auth-helpers"

export function registerSessionCoreRoutes(app: Hono) {
  app.get("/api/session/list", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    return c.json(jsonOk(await listUserSessionOverview(user), reqId))
  })

  app.post("/api/session/create", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const body = createSessionSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid session payload", 400, reqId, body.error.flatten()), 400)
    }

    const result = await createSessionForUser({
      user,
      requestId: reqId,
      title: body.data.title,
      projectId: body.data.projectId,
      workspaceId: body.data.workspaceId,
    })
    if (!result.ok) {
      if (result.reason === "worker_not_found") {
        return c.json(jsonError("worker not found", 503, reqId), 503)
      }
      if (result.reason === "workspace_not_found") {
        return c.json(jsonError("workspace not found", 404, reqId), 404)
      }
      if (result.reason === "forbidden") {
        return c.json(jsonError("forbidden", 403, reqId), 403)
      }
      return c.json(jsonError("workspace path is invalid", 409, reqId), 409)
    }

    return c.json(jsonOk(result.session, reqId))
  })

  app.get("/api/session/detail", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const sessionId = c.req.query("businessSessionId")
    if (!sessionId) {
      return c.json(jsonError("businessSessionId is required", 400, reqId), 400)
    }

    const result = await getSessionDetailForUser({
      user,
      businessSessionId: sessionId,
    })
    if (!result.ok) {
      if (result.reason === "session_not_found") {
        return c.json(jsonError("session not found", 404, reqId), 404)
      }
      return c.json(jsonError("forbidden", 403, reqId), 403)
    }

    return c.json(
      jsonOk(
        {
          session: result.session,
          events: result.events,
        },
        reqId,
      ),
    )
  })

  app.post("/api/session/close", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const body = sessionIdSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid close payload", 400, reqId, body.error.flatten()), 400)
    }

    const result = await closeSessionForUser({
      user,
      requestId: reqId,
      businessSessionId: body.data.businessSessionId,
    })
    if (!result.ok) {
      if (result.reason === "session_not_found") {
        return c.json(jsonError("session not found", 404, reqId), 404)
      }
      return c.json(jsonError("forbidden", 403, reqId), 403)
    }

    return c.json(jsonOk(result.session, reqId))
  })

  app.post("/api/acp/session/open", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const body = sessionIdSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid open payload", 400, reqId, body.error.flatten()), 400)
    }

    const result = await openSessionForUser({
      user,
      requestId: reqId,
      businessSessionId: body.data.businessSessionId,
    })
    if (!result.ok) {
      if (result.reason === "session_not_found") {
        return c.json(jsonError("session not found", 404, reqId), 404)
      }
      if (result.reason === "forbidden") {
        return c.json(jsonError("forbidden", 403, reqId), 403)
      }
      return c.json(jsonError("failed to open session", 500, reqId), 500)
    }

    return c.json(jsonOk(result.session, reqId))
  })
}
