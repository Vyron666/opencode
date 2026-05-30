import type { Hono } from "hono"
import {
  updateSessionConfigForUser,
  updateSessionModeForUser,
  updateSessionModelForUser,
} from "../../services/runtime/runtime-session-service"
import { configSchema, modeSchema, modelSchema } from "../schemas"
import { jsonError, jsonOk, requestId } from "../response"
import { requireUser, unauthorized } from "../auth-helpers"
import { replyRuntimeSettingError } from "./acp-session-route-helpers"

export function registerAcpSessionSettingsRoutes(app: Hono) {
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
    if (!result.ok) return replyRuntimeSettingError(c, reqId, result.reason)
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
    if (!result.ok) return replyRuntimeSettingError(c, reqId, result.reason)
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
    if (!result.ok) return replyRuntimeSettingError(c, reqId, result.reason)
    return c.json(jsonOk({ success: true }, reqId))
  })
}
