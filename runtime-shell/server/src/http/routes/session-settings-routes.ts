import type { Hono } from "hono"
import { closeRuntime } from "../../acp-runtime-manager"
import { Config, getCustomModels, invalidateCustomModelsCache } from "../../config"
import { listProviderConfigs, saveProviderConfig } from "../../provider-config"
import { store } from "../../store"
import { providerConfigSchema } from "../schemas"
import { jsonError, jsonOk, requestId } from "../response"
import { requireUser, unauthorized } from "../auth-helpers"

export function registerSessionSettingsRoutes(app: Hono) {
  app.get("/api/custom-models", async (c) => {
    const reqId = requestId(c)
    const user = requireUser(c)
    if (!user) return unauthorized(c)
    const models = await getCustomModels()
    return c.json(jsonOk({ items: models }, reqId))
  })

  app.post("/api/custom-models", async (c) => {
    const reqId = requestId(c)
    const user = requireUser(c)
    if (!user) return unauthorized(c)
    const body = await c.req.json()
    if (!body || !Array.isArray(body.models)) {
      return c.json(jsonError("models array is required", 400, reqId), 400)
    }
    const filePath = process.env.RUNTIME_SHELL_CUSTOM_MODELS_FILE || `${Config.dataFile}.custom-models.json`
    await Bun.write(filePath, JSON.stringify(body.models, null, 2))
    invalidateCustomModelsCache()
    return c.json(jsonOk({ success: true, count: body.models.length }, reqId))
  })

  app.get("/api/provider-config", async (c) => {
    const reqId = requestId(c)
    const user = requireUser(c)
    if (!user) return unauthorized(c)
    const items = await listProviderConfigs()
    return c.json(jsonOk({ items }, reqId))
  })

  app.post("/api/provider-config/save", async (c) => {
    const reqId = requestId(c)
    const user = requireUser(c)
    if (!user) return unauthorized(c)
    const body = providerConfigSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid provider config payload", 400, reqId, body.error.flatten()), 400)
    }

    const saved = await saveProviderConfig(body.data)
    const affectedSessions = store
      .listUserSessions(user)
      .filter((session) => session.status === "active" || session.status === "created")

    for (const session of affectedSessions) {
      await closeRuntime(session.id)
      await store.updateSession(session.id, {
        status: "created",
      })
    }

    const auditLogTask = store.appendAuditLog({
      tenantId: user.tenantId,
      organizationId: user.organizationId,
      userId: user.id,
      requestId: reqId,
      action: "provider.save",
      resourceType: "provider_config",
      resourceId: saved.providerId,
      detail: {
        reloadedSessionCount: affectedSessions.length,
      },
    })
    ////////////// runtime-shell customization start //////////////
    // 中文/English: provider save should return as soon as runtime reload work
    // is done, without waiting on audit persistence.
    void auditLogTask
    ////////////// runtime-shell customization end //////////////

    return c.json(
      jsonOk(
        {
          success: true,
          providerId: saved.providerId,
          reloadedSessionCount: affectedSessions.length,
        },
        reqId,
      ),
    )
  })
}
