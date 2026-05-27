import type { Hono } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import { Config } from "../../config"
import { loginUser, logoutUser } from "../../services/auth/auth-application-service"
import { sanitizeUser } from "../../services/auth/auth-user-service"
import { loginSchema } from "../schemas"
import { jsonError, jsonOk, requestId } from "../response"
import { requireUser, unauthorized } from "../auth-helpers"

export function registerAuthRoutes(app: Hono) {
  app.post("/api/auth/login", async (c) => {
    const reqId = requestId(c)
    const body = loginSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid login payload", 400, reqId, body.error.flatten()), 400)
    }

    const result = await loginUser({
      username: body.data.username,
      password: body.data.password,
      requestId: reqId,
    })
    if (!result.ok) {
      return c.json(jsonError("invalid username or password", 401, reqId), 401)
    }

    setCookie(c, Config.sessionCookie, result.token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    })
    return c.json(
      jsonOk(
        {
          user: sanitizeUser(result.user),
          users: result.users,
        },
        reqId,
      ),
    )
  })

  app.post("/api/auth/logout", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    const token = getCookie(c, Config.sessionCookie)
    await logoutUser({
      user: user || undefined,
      token,
      requestId: reqId,
    })
    deleteCookie(c, Config.sessionCookie, { path: "/" })
    return c.json(jsonOk({ success: true }, reqId))
  })

  app.get("/api/auth/me", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    return c.json(jsonOk({ user: sanitizeUser(user) }, reqId))
  })
}
