import type { Hono } from "hono"
import { createWorkspaceForUser } from "../../services/workspace/workspace-create-service"
import { workspaceCreateSchema } from "../schemas"
import { jsonError, jsonOk, requestId } from "../response"
import { requireUser, unauthorized } from "../auth-helpers"

export function registerWorkspaceRoutes(app: Hono) {
  app.post("/api/workspace/create", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)

    const body = workspaceCreateSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid workspace payload", 400, reqId, body.error.flatten()), 400)
    }

    const result = await createWorkspaceForUser({
      user,
      requestId: reqId,
      projectId: body.data.projectId,
      name: body.data.name,
    })
    if (!result.ok) {
      if (result.reason === "invalid_name") {
        return c.json(jsonError("workspace name is invalid", 400, reqId), 400)
      }
      if (result.reason === "project_out_of_scope") {
        return c.json(jsonError("project is outside your scope", 403, reqId), 403)
      }
      if (result.reason === "create_failed") {
        return c.json(jsonError("failed to create workspace directory", 500, reqId), 500)
      }
      return c.json(jsonError("forbidden", 403, reqId), 403)
    }

    return c.json(jsonOk(result.workspace, reqId))
  })
}
