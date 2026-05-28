import type { Context } from "hono"
import { findBusinessSessionForUser } from "../services/session/session-access-service"
import { jsonError, requestId } from "./response"
import type { User } from "../types"

export async function requireBusinessSession(c: Context, sessionId: string, user?: User) {
  const result = await findBusinessSessionForUser(sessionId, user)
  if (result.ok) return result
  const reqId = requestId(c)
  if (result.reason === "session_not_found") {
    return {
      response: c.json(jsonError("session not found", 404, reqId), 404),
    }
  }
  if (result.reason === "workspace_not_shared") {
    return {
      response: c.json(jsonError("workspace is not shared with you", 403, reqId), 403),
    }
  }
  if (result.reason === "share_revoked") {
    return {
      response: c.json(jsonError("workspace share was revoked", 403, reqId), 403),
    }
  }
  if (result.reason === "scope_mismatch") {
    return {
      response: c.json(jsonError("session is outside your scope", 403, reqId), 403),
    }
  }
  return {
    response: c.json(jsonError("forbidden", 403, reqId), 403),
  }
}
