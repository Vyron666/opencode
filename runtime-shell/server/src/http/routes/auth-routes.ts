import type { Hono } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import { Config } from "../../config"
import { clearSession, createSession } from "../../auth"
import { store } from "../../store"
import { loginSchema } from "../schemas"
import { jsonError, jsonOk, requestId } from "../response"
import { requireUser, sanitizeUser, unauthorized } from "../auth-helpers"

export function registerAuthRoutes(app: Hono) {
  app.post("/api/auth/login", async (c) => {
    const reqId = requestId(c)
    const body = loginSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid login payload", 400, reqId, body.error.flatten()), 400)
    }
    const user = store.findUser(body.data.username, body.data.password)
    if (!user) {
      return c.json(jsonError("invalid username or password", 401, reqId), 401)
    }
    const token = await createSession(user)
    const auditLogTask = store.appendAuditLog({
      tenantId: user.tenantId,
      organizationId: user.organizationId,
      userId: user.id,
      requestId: reqId,
      action: "auth.login",
      resourceType: "auth_session",
      detail: {
        username: user.username,
      },
    })
    ////////////// runtime-shell customization start //////////////
    // 中文/English: login should return the session cookie immediately.
    // Audit persistence continues on the shared write queue in the background.
    void auditLogTask
    ////////////// runtime-shell customization end //////////////
    setCookie(c, Config.sessionCookie, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    })
    return c.json(
      jsonOk(
        {
          user: sanitizeUser(user),
          users: store.listUsers().map(sanitizeUser),
        },
        reqId,
      ),
    )
  })

  app.post("/api/auth/logout", async (c) => {
    const reqId = requestId(c)
    const user = requireUser(c)
    const token = getCookie(c, Config.sessionCookie)
    await clearSession(token)
    if (user) {
      const auditLogTask = store.appendAuditLog({
        tenantId: user.tenantId,
        organizationId: user.organizationId,
        userId: user.id,
        requestId: reqId,
        action: "auth.logout",
        resourceType: "auth_session",
        detail: {
          username: user.username,
        },
      })
      // 中文/English: logout should clear the cookie immediately instead of
      // waiting on audit durability.
      void auditLogTask
    }
    deleteCookie(c, Config.sessionCookie, { path: "/" })
    return c.json(jsonOk({ success: true }, reqId))
  })

  app.get("/api/auth/me", (c) => {
    const reqId = requestId(c)
    const user = requireUser(c)
    if (!user) return unauthorized(c)
    return c.json(jsonOk({ user: sanitizeUser(user) }, reqId))
  })
}
