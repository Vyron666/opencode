import type { Hono } from "hono"
import { closeRuntime } from "../../acp-runtime-manager"
import { store } from "../../store"
import { createSessionSchema, sessionIdSchema } from "../schemas"
import { jsonError, jsonOk, requestId } from "../response"
import { requireUser, unauthorized } from "../auth-helpers"
import {
  ensureWorkspaceForUser,
  openSessionWithFallback,
  requireBusinessSession,
  sessionSummary,
} from "../session-helpers"

export function registerSessionCoreRoutes(app: Hono) {
  app.get("/api/session/list", (c) => {
    const reqId = requestId(c)
    const user = requireUser(c)
    if (!user) return unauthorized(c)
    return c.json(
      jsonOk(
        {
          items: store.listUserSessions(user).map(sessionSummary),
          workspaces: store.listUserWorkspaces(user),
        },
        reqId,
      ),
    )
  })

  app.post("/api/session/create", async (c) => {
    const reqId = requestId(c)
    const user = requireUser(c)
    if (!user) return unauthorized(c)
    const body = createSessionSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid session payload", 400, reqId, body.error.flatten()), 400)
    }
    const worker = store.listWorkers()[0]
    if (!worker) return c.json(jsonError("worker not found", 503, reqId), 503)
    const workspaceResult = await ensureWorkspaceForUser({
      user,
      projectId: body.data.projectId,
      workspaceId: body.data.workspaceId,
    })
    if (!workspaceResult.ok) {
      if (workspaceResult.reason === "workspace_not_found") {
        return c.json(jsonError("workspace not found", 404, reqId), 404)
      }
      if (workspaceResult.reason === "forbidden") {
        return c.json(jsonError("forbidden", 403, reqId), 403)
      }
      return c.json(jsonError("workspace path is invalid", 409, reqId), 409)
    }
    const workspace = workspaceResult.workspace
    const session = await store.createSession({
      title: body.data.title,
      projectId: body.data.projectId,
      workspace,
      user,
      workerId: worker.id,
    })
    const auditLogTask = store.appendAuditLog({
      tenantId: user.tenantId,
      organizationId: user.organizationId,
      userId: user.id,
      businessSessionId: session.id,
      requestId: reqId,
      action: "session.create",
      resourceType: "business_session",
      resourceId: session.id,
      detail: {
        title: session.title,
        workspaceId: workspace.id,
        workspacePath: workspace.rootPath,
      },
    })
    ////////////// runtime-shell customization start //////////////
    // 中文/English: session creation should return immediately after the session
    // row exists, without waiting behind the shared disk write queue for audit persistence.
    void auditLogTask
    ////////////// runtime-shell customization end //////////////
    return c.json(jsonOk(sessionSummary(session), reqId))
  })

  app.get("/api/session/detail", async (c) => {
    const reqId = requestId(c)
    const user = requireUser(c)
    if (!user) return unauthorized(c)
    const sessionId = c.req.query("businessSessionId")
    if (!sessionId) {
      return c.json(jsonError("businessSessionId is required", 400, reqId), 400)
    }
    const result = requireBusinessSession(c, sessionId, user)
    if ("response" in result) return result.response
    return c.json(
      jsonOk(
        {
          session: sessionSummary(result.session),
          events: store.listEvents(result.session.id),
        },
        reqId,
      ),
    )
  })

  app.post("/api/session/close", async (c) => {
    const reqId = requestId(c)
    const user = requireUser(c)
    if (!user) return unauthorized(c)
    const body = sessionIdSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid close payload", 400, reqId, body.error.flatten()), 400)
    }
    const result = requireBusinessSession(c, body.data.businessSessionId, user)
    if ("response" in result) return result.response

    const closedReal = await closeRuntime(result.session.id)
    const closed = await store.updateSession(result.session.id, {
      status: "completed",
    })
    const auditLogTask = store.appendAuditLog({
      tenantId: result.session.tenantId,
      organizationId: result.session.organizationId,
      userId: user.id,
      businessSessionId: result.session.id,
      requestId: reqId,
      action: "session.close",
      resourceType: "business_session",
      resourceId: result.session.id,
      detail: {
        closedReal,
      },
    })
    // 中文/English: closing the session should update the UI immediately;
    // audit durability continues on the background write queue.
    void auditLogTask
    return c.json(jsonOk(sessionSummary(closed || result.session), reqId))
  })

  app.post("/api/acp/session/open", async (c) => {
    const reqId = requestId(c)
    const user = requireUser(c)
    if (!user) return unauthorized(c)
    const body = sessionIdSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid open payload", 400, reqId, body.error.flatten()), 400)
    }
    const result = requireBusinessSession(c, body.data.businessSessionId, user)
    if ("response" in result) return result.response
    const opened = await openSessionWithFallback(result.session, store.getWorkspace(result.session.workspaceId))
    if (!opened) return c.json(jsonError("failed to open session", 500, reqId), 500)
    const auditLogTask = store.appendAuditLog({
      tenantId: opened.tenantId,
      organizationId: opened.organizationId,
      userId: user.id,
      businessSessionId: opened.id,
      requestId: reqId,
      action: "session.open",
      resourceType: "business_session",
      resourceId: opened.id,
      detail: {},
    })
    // 中文/English: opening should not stall the frontend on audit persistence.
    void auditLogTask
    return c.json(jsonOk(sessionSummary(opened), reqId))
  })
}
