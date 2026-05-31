import type { Hono } from "hono"
import { listConfigHistory } from "../../services/config-history/config-history-service"
import { listConfigApprovals, reviewConfigApproval } from "../../services/config-approval/config-approval-service"
import {
  listMcpConfigsForUser,
  listProviderConfigsForUser,
  listSkillConfigForUser,
  previewConfigImpactForUser,
  saveMcpConfigsForUser,
  saveProviderConfigForUser,
  saveSkillConfigForUser,
} from "../../services/settings/settings-service"
import { configApprovalReviewSchema, configHistoryListSchema, configImpactPreviewSchema, mcpConfigSchema, providerConfigSchema, skillConfigSchema } from "../schemas"
import { jsonError, jsonOk, requestId } from "../response"
import { requireUser, unauthorized } from "../auth-helpers"

export function registerSessionSettingsRoutes(app: Hono) {
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

  app.get("/api/mcp-config", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const result = await listMcpConfigsForUser(user)
    if (!result.ok) {
      return c.json(jsonError("forbidden", 403, reqId), 403)
    }
    return c.json(jsonOk({ items: result.items }, reqId))
  })

  app.post("/api/mcp-config/save", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const body = mcpConfigSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid mcp config payload", 400, reqId, body.error.flatten()), 400)
    }
    const result = await saveMcpConfigsForUser({
      user,
      requestId: reqId,
      servers: body.data.servers,
    })
    if (!result.ok) {
      if (result.reason === "conflict_with_platform_shared") {
        return c.json(jsonError(`mcp '${result.name}' conflicts with platform shared config`, 409, reqId), 409)
      }
      return c.json(jsonError("forbidden", 403, reqId), 403)
    }
    return c.json(jsonOk({ success: result.success, approvalRequired: result.approvalRequired, approval: result.approval, count: result.count }, reqId))
  })

  app.get("/api/skill-config", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const result = await listSkillConfigForUser(user)
    if (!result.ok) {
      return c.json(jsonError("forbidden", 403, reqId), 403)
    }
    return c.json(jsonOk(result.config, reqId))
  })

  app.post("/api/skill-config/save", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const body = skillConfigSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid skill config payload", 400, reqId, body.error.flatten()), 400)
    }
    const result = await saveSkillConfigForUser({
      user,
      requestId: reqId,
      config: body.data,
    })
    if (!result.ok) {
      return c.json(jsonError("forbidden", 403, reqId), 403)
    }
    return c.json(jsonOk({ success: result.success, approvalRequired: result.approvalRequired, approval: result.approval }, reqId))
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
      if (result.reason === "conflict_with_platform_shared") {
        return c.json(jsonError(`provider '${result.providerId}' conflicts with platform shared config`, 409, reqId), 409)
      }
      return c.json(jsonError("forbidden", 403, reqId), 403)
    }
    return c.json(
      jsonOk(
        {
          success: result.success,
          approvalRequired: result.approvalRequired,
          approval: result.approval,
          providerId: result.providerId,
          reloadedSessionCount: result.reloadedSessionCount,
        },
        reqId,
      ),
    )
  })

  app.post("/api/config-impact/preview", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const body = configImpactPreviewSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid config impact preview payload", 400, reqId, body.error.flatten()), 400)
    }
    const result = await previewConfigImpactForUser({
      user,
      namespace: body.data.namespace,
      targetId: body.data.targetId,
    })
    if (!result.ok) {
      return c.json(jsonError("forbidden", 403, reqId), 403)
    }
    return c.json(jsonOk(result.preview, reqId))
  })

  app.get("/api/config-history/list", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const query = configHistoryListSchema.safeParse({
      namespace: c.req.query("namespace") || undefined,
      limit: c.req.query("limit") || undefined,
    })
    if (!query.success) {
      return c.json(jsonError("invalid config history query", 400, reqId, query.error.flatten()), 400)
    }
    const result = await listConfigHistory({
      user,
      namespace: query.data.namespace,
      limit: query.data.limit,
    })
    if (!result.ok) {
      return c.json(jsonError("forbidden", 403, reqId), 403)
    }
    return c.json(jsonOk({ items: result.items }, reqId))
  })

  app.get("/api/config-approval/list", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const result = await listConfigApprovals(user)
    if (!result.ok) {
      return c.json(jsonError("forbidden", 403, reqId), 403)
    }
    return c.json(jsonOk({ items: result.items }, reqId))
  })

  app.post("/api/config-approval/review", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const body = configApprovalReviewSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid config approval review payload", 400, reqId, body.error.flatten()), 400)
    }
    const result = await reviewConfigApproval({
      user,
      requestId: reqId,
      approvalId: body.data.approvalId,
      decision: body.data.decision,
      comment: body.data.comment,
    })
    if (!result.ok) {
      if (result.reason === "not_found") {
        return c.json(jsonError("approval request not found", 404, reqId), 404)
      }
      if (result.reason === "invalid_status") {
        return c.json(jsonError("approval request is not pending", 409, reqId), 409)
      }
      if (result.reason === "invalid_payload") {
        return c.json(jsonError("approval payload is invalid", 400, reqId), 400)
      }
      return c.json(jsonError("forbidden", 403, reqId), 403)
    }
    return c.json(jsonOk({ approval: result.approval }, reqId))
  })
}
