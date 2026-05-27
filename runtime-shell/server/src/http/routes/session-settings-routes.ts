import type { Hono } from "hono"
import {
  listCustomModelsForUser,
  listProviderConfigsForUser,
  saveCustomModelsForUser,
  saveProviderConfigForUser,
} from "../../services/settings/settings-service"
import { providerConfigSchema } from "../schemas"
import { jsonError, jsonOk, requestId } from "../response"
import { requireUser, unauthorized } from "../auth-helpers"

export function registerSessionSettingsRoutes(app: Hono) {
  app.get("/api/custom-models", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const result = await listCustomModelsForUser(user)
    if (!result.ok) {
      return c.json(jsonError("forbidden", 403, reqId), 403)
    }
    return c.json(jsonOk({ items: result.items }, reqId))
  })

  app.post("/api/custom-models", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const body = await c.req.json()
    if (!body || !Array.isArray(body.models)) {
      return c.json(jsonError("models array is required", 400, reqId), 400)
    }

    const result = await saveCustomModelsForUser({
      user,
      requestId: reqId,
      models: body.models,
    })
    if (!result.ok) {
      return c.json(jsonError("forbidden", 403, reqId), 403)
    }
    return c.json(jsonOk({ success: result.success, count: result.count }, reqId))
  })

  app.get("/api/provider-config", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const result = await listProviderConfigsForUser(user)
    if (!result.ok) {
      return c.json(jsonError("forbidden", 403, reqId), 403)
    }
    return c.json(jsonOk({ items: result.items }, reqId))
  })

  app.post("/api/provider-config/save", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const body = providerConfigSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid provider config payload", 400, reqId, body.error.flatten()), 400)
    }

    const result = await saveProviderConfigForUser({
      user,
      requestId: reqId,
      config: body.data,
    })
    if (!result.ok) {
      return c.json(jsonError("forbidden", 403, reqId), 403)
    }
    return c.json(
      jsonOk(
        {
          success: result.success,
          providerId: result.providerId,
          reloadedSessionCount: result.reloadedSessionCount,
        },
        reqId,
      ),
    )
  })
}
