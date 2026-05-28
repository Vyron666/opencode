import type { Hono } from "hono"
import {
  createWorkspaceShareForUser,
  deleteWorkspaceShareForUser,
} from "../../services/session/workspace-share-application-service"
import { workspaceShareSchema } from "../schemas"
import { jsonError, jsonOk, requestId } from "../response"
import { requireUser, unauthorized } from "../auth-helpers"

export function registerWorkspaceShareRoutes(app: Hono) {
  app.post("/api/workspace/share/create", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const body = workspaceShareSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid share payload", 400, reqId, body.error.flatten()), 400)
    }

    const result = await createWorkspaceShareForUser({
      user,
      requestId: reqId,
      workspaceId: body.data.workspaceId,
      projectId: body.data.projectId,
      targetUserId: body.data.targetUserId,
    })
    if (!result.ok) {
      if (result.reason === "workspace_not_found") {
        return c.json(jsonError("workspace not found", 404, reqId), 404)
      }
      if (result.reason === "target_user_not_found") {
        return c.json(jsonError("target user not found", 404, reqId), 404)
      }
      if (result.reason === "share_target_invalid") {
        return c.json(jsonError("target user is invalid", 409, reqId), 409)
      }
      if (result.reason === "scope_mismatch") {
        return c.json(jsonError("workspace is outside your scope", 403, reqId), 403)
      }
      if (result.reason === "workspace_disabled") {
        return c.json(jsonError("workspace is disabled", 409, reqId), 409)
      }
      if (result.reason === "invalid_path") {
        return c.json(jsonError("workspace path is invalid", 409, reqId), 409)
      }
      return c.json(jsonError("forbidden", 403, reqId), 403)
    }

    return c.json(jsonOk({ binding: result.binding }, reqId))
  })

  app.post("/api/workspace/share/delete", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const body = workspaceShareSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid unshare payload", 400, reqId, body.error.flatten()), 400)
    }

    const result = await deleteWorkspaceShareForUser({
      user,
      requestId: reqId,
      workspaceId: body.data.workspaceId,
      projectId: body.data.projectId,
      targetUserId: body.data.targetUserId,
    })
    if (!result.ok) {
      if (result.reason === "workspace_not_found") {
        return c.json(jsonError("workspace not found", 404, reqId), 404)
      }
      if (result.reason === "share_not_found") {
        return c.json(jsonError("share not found", 404, reqId), 404)
      }
      if (result.reason === "scope_mismatch") {
        return c.json(jsonError("workspace is outside your scope", 403, reqId), 403)
      }
      if (result.reason === "workspace_disabled") {
        return c.json(jsonError("workspace is disabled", 409, reqId), 409)
      }
      if (result.reason === "invalid_path") {
        return c.json(jsonError("workspace path is invalid", 409, reqId), 409)
      }
      return c.json(jsonError("forbidden", 403, reqId), 403)
    }

    return c.json(jsonOk({ success: true }, reqId))
  })
}
