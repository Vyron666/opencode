import { jsonError } from "../response"

const SHARED_SESSION_ACCESS_REASONS = new Set(["workspace_not_shared", "share_revoked", "scope_mismatch", "forbidden"])
const RUNTIME_WORKSPACE_REASONS = new Set(["workspace_not_found", "workspace_disabled", "invalid_path"])

export function isSharedSessionAccessReason(reason: string) {
  return SHARED_SESSION_ACCESS_REASONS.has(reason)
}

export function isRuntimeWorkspaceReason(reason: string) {
  return RUNTIME_WORKSPACE_REASONS.has(reason)
}

export function mapSharedSessionAccessError(reason: string, reqId: string) {
  if (reason === "workspace_not_shared") {
    return { status: 403 as const, body: jsonError("workspace is not shared with you", 403, reqId) }
  }
  if (reason === "share_revoked") {
    return { status: 403 as const, body: jsonError("workspace share was revoked", 403, reqId) }
  }
  if (reason === "scope_mismatch") {
    return { status: 403 as const, body: jsonError("session is outside your scope", 403, reqId) }
  }
  return { status: 403 as const, body: jsonError("forbidden", 403, reqId) }
}

export function mapRuntimeWorkspaceError(reason: string, reqId: string) {
  if (reason === "workspace_not_found") {
    return { status: 404 as const, body: jsonError("workspace not found", 404, reqId) }
  }
  if (reason === "workspace_disabled") {
    return { status: 409 as const, body: jsonError("workspace is disabled", 409, reqId) }
  }
  return { status: 409 as const, body: jsonError("workspace path is invalid", 409, reqId) }
}
