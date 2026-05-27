import { clearSession, createSession } from "../../auth"
import type { User } from "../../types"
import { sanitizeUser } from "./auth-user-service"
import { auditService, userService } from "../store/store-singleton"

export async function loginUser(input: {
  username: string
  password: string
  requestId: string
}) {
  const user = userService.findUser(input.username, input.password)
  if (!user) return { ok: false as const, reason: "invalid_credentials" }

  const token = await createSession(user)
  const auditLogTask = auditService.appendAuditLog({
    tenantId: user.tenantId,
    organizationId: user.organizationId,
    userId: user.id,
    requestId: input.requestId,
    action: "auth.login",
    resourceType: "auth_session",
    detail: {
      username: user.username,
    },
  })
  // 中文/English: auth login should return cookie-ready result without waiting for audit persistence.
  void auditLogTask

  return {
    ok: true as const,
    token,
    user,
    users: userService.listUsers().map(sanitizeUser),
  }
}

export async function logoutUser(input: {
  user?: User
  token?: string | null
  requestId: string
}) {
  await clearSession(input.token)
  if (!input.user) return { success: true }

  const auditLogTask = auditService.appendAuditLog({
    tenantId: input.user.tenantId,
    organizationId: input.user.organizationId,
    userId: input.user.id,
    requestId: input.requestId,
    action: "auth.logout",
    resourceType: "auth_session",
    detail: {
      username: input.user.username,
    },
  })
  // 中文/English: logout should clear the cookie immediately and let audit persist asynchronously.
  void auditLogTask

  return { success: true }
}
