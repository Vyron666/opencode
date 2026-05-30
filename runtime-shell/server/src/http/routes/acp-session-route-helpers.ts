import type { Context } from "hono"
import { jsonError } from "../response"
import {
  isRuntimeWorkspaceReason,
  isSharedSessionAccessReason,
  mapRuntimeWorkspaceError,
  mapSharedSessionAccessError,
} from "./acp-session-route-support"

export function replyRuntimeSessionError(c: Context, reqId: string, reason: string) {
  if (reason === "session_not_found") return c.json(jsonError("session not found", 404, reqId), 404)
  if (isRuntimeWorkspaceReason(reason)) {
    const mapped = mapRuntimeWorkspaceError(reason, reqId)
    return c.json(mapped.body, mapped.status)
  }
  if (isSharedSessionAccessReason(reason)) {
    const mapped = mapSharedSessionAccessError(reason, reqId)
    return c.json(mapped.body, mapped.status)
  }
  return c.json(jsonError("forbidden", 403, reqId), 403)
}

export function replySharedSessionError(c: Context, reqId: string, reason: string) {
  if (reason === "session_not_found") return c.json(jsonError("session not found", 404, reqId), 404)
  if (isSharedSessionAccessReason(reason)) {
    const mapped = mapSharedSessionAccessError(reason, reqId)
    return c.json(mapped.body, mapped.status)
  }
  return c.json(jsonError("forbidden", 403, reqId), 403)
}

export function replyRuntimeSettingError(c: Context, reqId: string, reason: string) {
  if (reason === "session_not_found") return c.json(jsonError("session not found", 404, reqId), 404)
  if (isSharedSessionAccessReason(reason)) {
    const mapped = mapSharedSessionAccessError(reason, reqId)
    return c.json(mapped.body, mapped.status)
  }
  return c.json(jsonError("session runtime settings are not available right now", 409, reqId), 409)
}
