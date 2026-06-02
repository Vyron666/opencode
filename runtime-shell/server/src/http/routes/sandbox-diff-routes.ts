import type { Hono } from "hono"
import type { Context } from "hono"
import {
  applySessionDiffForUser,
  createSessionDiffForUser,
  getSessionDiffForUser,
  rejectSessionDiffForUser,
} from "../../services/sandbox/sandbox-diff-application-service"
import { requireUser, unauthorized } from "../auth-helpers"
import { jsonError, jsonOk, requestId } from "../response"
import { sessionDiffApplySchema, sessionDiffCreateSchema, sessionDiffRejectSchema } from "../schemas"

export function registerSandboxDiffRoutes(app: Hono) {
  app.get("/api/session/diff", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const businessSessionId = c.req.query("businessSessionId")
    if (!businessSessionId) return c.json(jsonError("businessSessionId is required", 400, reqId), 400)
    const result = await getSessionDiffForUser({
      user,
      businessSessionId,
    })
    if (!result.ok) return replySandboxDiffError(c, reqId, result.reason)
    return c.json(jsonOk(result.diff, reqId))
  })

  app.post("/api/session/diff/create", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const body = sessionDiffCreateSchema.safeParse(await c.req.json())
    if (!body.success) return c.json(jsonError("invalid diff create payload", 400, reqId, body.error.flatten()), 400)
    const result = await createSessionDiffForUser({
      user,
      businessSessionId: body.data.businessSessionId,
    })
    if (!result.ok) return replySandboxDiffError(c, reqId, result.reason)
    return c.json(jsonOk(result.diff, reqId))
  })

  app.post("/api/session/diff/apply", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const body = sessionDiffApplySchema.safeParse(await c.req.json())
    if (!body.success) return c.json(jsonError("invalid diff apply payload", 400, reqId, body.error.flatten()), 400)
    const result = await applySessionDiffForUser({
      user,
      businessSessionId: body.data.businessSessionId,
      diffId: body.data.diffId,
      idempotencyKey: body.data.idempotencyKey,
    })
    if (!result.ok) return replySandboxDiffError(c, reqId, result.reason)
    return c.json(jsonOk(result.diff, reqId))
  })

  app.post("/api/session/diff/reject", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const body = sessionDiffRejectSchema.safeParse(await c.req.json())
    if (!body.success) return c.json(jsonError("invalid diff reject payload", 400, reqId, body.error.flatten()), 400)
    const result = await rejectSessionDiffForUser({
      user,
      businessSessionId: body.data.businessSessionId,
      diffId: body.data.diffId,
    })
    if (!result.ok) return replySandboxDiffError(c, reqId, result.reason)
    return c.json(jsonOk(result.diff, reqId))
  })
}

function replySandboxDiffError(c: Context, reqId: string, reason: string) {
  if (reason === "session_not_found") return c.json(jsonError("session not found", 404, reqId), 404)
  if (reason === "sandbox_workspace_not_found") return c.json(jsonError("sandbox workspace not found", 409, reqId), 409)
  if (reason === "sandbox_diff_not_found") return c.json(jsonError("sandbox diff not found", 404, reqId), 404)
  return c.json(jsonError("forbidden", 403, reqId), 403)
}
