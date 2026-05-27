import type { Context } from "hono"
import { getCookie } from "hono/cookie"
import { Config } from "../config"
import { getUserBySessionToken } from "../services/auth/auth-user-service"
import { jsonError, requestId } from "./response"

export async function requireUser(c: Context) {
  const token = getCookie(c, Config.sessionCookie)
  return await getUserBySessionToken(token)
}

export function unauthorized(c: Context) {
  const reqId = requestId(c)
  return c.json(jsonError("unauthorized", 401, reqId), 401)
}
