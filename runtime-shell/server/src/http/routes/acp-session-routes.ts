import type { Hono } from "hono"
import {
  cancelPromptForUser,
  forkSessionRuntimeForUser,
  loadSessionRuntimeForUser,
  resumeSessionRuntimeForUser,
  submitPromptForUser,
  updateSessionConfigForUser,
  updateSessionModeForUser,
  updateSessionModelForUser,
} from "../../services/runtime/runtime-session-service"
import {
  configSchema,
  forkSessionSchema,
  inputSchema,
  modeSchema,
  modelSchema,
  sessionIdSchema,
} from "../schemas"
import { jsonError, jsonOk, requestId } from "../response"
import { requireUser, unauthorized } from "../auth-helpers"

export function registerAcpSessionRoutes(app: Hono) {
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
    if (!result.ok) {
      if (result.reason === "session_not_found") {
        return c.json(jsonError("session not found", 404, reqId), 404)
      }
      return c.json(jsonError("forbidden", 403, reqId), 403)
    }

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
    if (!result.ok) {
      if (result.reason === "session_not_found") {
        return c.json(jsonError("session not found", 404, reqId), 404)
      }
      return c.json(jsonError("forbidden", 403, reqId), 403)
    }

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
    if (!result.ok) {
      if (result.reason === "session_not_found") {
        return c.json(jsonError("session not found", 404, reqId), 404)
      }
      return c.json(jsonError("forbidden", 403, reqId), 403)
    }

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
      if (result.reason === "session_not_found") {
        return c.json(jsonError("session not found", 404, reqId), 404)
      }
      if (result.reason === "forbidden") {
        return c.json(jsonError("forbidden", 403, reqId), 403)
      }
      return c.json(jsonError("session runtime is not active", 409, reqId), 409)
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
      if (result.reason === "session_not_found") {
        return c.json(jsonError("session not found", 404, reqId), 404)
      }
      if (result.reason === "forbidden") {
        return c.json(jsonError("forbidden", 403, reqId), 403)
      }
      return c.json(jsonError("session runtime is not active", 409, reqId), 409)
    }

    return c.json(jsonOk({ success: true }, reqId))
  })

  app.post("/api/acp/session/mode/update", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const body = modeSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid mode payload", 400, reqId, body.error.flatten()), 400)
    }

    const result = await updateSessionModeForUser({
      user,
      businessSessionId: body.data.businessSessionId,
      modeId: body.data.modeId,
    })
    if (!result.ok) {
      if (result.reason === "session_not_found") {
        return c.json(jsonError("session not found", 404, reqId), 404)
      }
      if (result.reason === "forbidden") {
        return c.json(jsonError("forbidden", 403, reqId), 403)
      }
      return c.json(jsonError("session runtime is not active", 409, reqId), 409)
    }

    return c.json(jsonOk({ success: true }, reqId))
  })

  app.post("/api/acp/session/model/update", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const body = modelSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid model payload", 400, reqId, body.error.flatten()), 400)
    }

    const result = await updateSessionModelForUser({
      user,
      businessSessionId: body.data.businessSessionId,
      modelId: body.data.modelId,
    })
    if (!result.ok) {
      if (result.reason === "session_not_found") {
        return c.json(jsonError("session not found", 404, reqId), 404)
      }
      if (result.reason === "forbidden") {
        return c.json(jsonError("forbidden", 403, reqId), 403)
      }
      return c.json(jsonError("session runtime is not active", 409, reqId), 409)
    }

    return c.json(jsonOk({ success: true }, reqId))
  })

  app.post("/api/acp/session/config/update", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const body = configSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid config payload", 400, reqId, body.error.flatten()), 400)
    }

    const result = await updateSessionConfigForUser({
      user,
      businessSessionId: body.data.businessSessionId,
      configId: body.data.configId,
      value: body.data.value,
    })
    if (!result.ok) {
      if (result.reason === "session_not_found") {
        return c.json(jsonError("session not found", 404, reqId), 404)
      }
      if (result.reason === "forbidden") {
        return c.json(jsonError("forbidden", 403, reqId), 403)
      }
      return c.json(jsonError("session runtime is not active", 409, reqId), 409)
    }

    return c.json(jsonOk({ success: true }, reqId))
  })
}
