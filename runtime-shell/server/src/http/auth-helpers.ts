import type { Context } from "hono"
import { getCookie } from "hono/cookie"
import { Config } from "../config"
import { getSession } from "../auth"
import { jsonError, requestId } from "./response"
import type { User } from "../types"

export function requireUser(c: Context) {
  const token = getCookie(c, Config.sessionCookie)
  return getSession(token)
}

export function sanitizeUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    tenantId: user.tenantId,
    organizationId: user.organizationId,
  }
}

export function unauthorized(c: Context) {
  const reqId = requestId(c)
  return c.json(jsonError("unauthorized", 401, reqId), 401)
}
