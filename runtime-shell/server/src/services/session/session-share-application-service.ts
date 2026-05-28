import type { BusinessSession, User } from "../../types"
import { auditService, sessionShareService, userService } from "../store/store-singleton"
import { requireSessionAction } from "./session-access-service"

export async function createSessionShareForUser(input: {
  user: User
  requestId: string
  businessSessionId: string
  targetUserId: string
}) {
  if (input.user.id === input.targetUserId) {
    return { ok: false as const, reason: "share_target_invalid" }
  }
  const result = await requireSessionAction({
    user: input.user,
    sessionId: input.businessSessionId,
    action: "share_create",
  })
  if (!result.ok) return result
  const targetUser = userService.getUser(input.targetUserId)
  if (!targetUser) return { ok: false as const, reason: "target_user_not_found" }
  if (
    targetUser.tenantId !== input.user.tenantId ||
    targetUser.organizationId !== input.user.organizationId
  ) {
    return { ok: false as const, reason: "forbidden" }
  }
  return createSessionShareForValidatedUser({
    actor: input.user,
    requestId: input.requestId,
    session: result.session,
    targetUserId: input.targetUserId,
  })
}

export async function deleteSessionShareForUser(input: {
  user: User
  requestId: string
  businessSessionId: string
  targetUserId: string
}) {
  const result = await requireSessionAction({
    user: input.user,
    sessionId: input.businessSessionId,
    action: "share_delete",
  })
  if (!result.ok) return result
  const revoked = await sessionShareService.revokeShareBinding({
    businessSessionId: result.session.id,
    targetUserId: input.targetUserId,
    updatedBy: input.user.id,
  })
  if (!revoked) return { ok: false as const, reason: "share_not_found" }

  const auditLogTask = auditService.appendAuditLog({
    tenantId: result.session.tenantId,
    organizationId: result.session.organizationId,
    userId: input.user.id,
    businessSessionId: result.session.id,
    requestId: input.requestId,
    action: "session.unshare",
    resourceType: "session_share_binding",
    resourceId: `${result.session.id}:${input.targetUserId}`,
    detail: {
      targetUserId: input.targetUserId,
      workspaceId: result.session.workspaceId,
    },
  })
  void auditLogTask

  return { ok: true as const, success: true }
}

async function createSessionShareForValidatedUser(input: {
  actor: User
  requestId: string
  session: BusinessSession
  targetUserId: string
}) {
  const binding = await sessionShareService.createShareBinding({
    session: input.session,
    ownerUserId: input.actor.id,
    targetUserId: input.targetUserId,
  })
  const auditLogTask = auditService.appendAuditLog({
    tenantId: input.session.tenantId,
    organizationId: input.session.organizationId,
    userId: input.actor.id,
    businessSessionId: input.session.id,
    requestId: input.requestId,
    action: "session.share",
    resourceType: "session_share_binding",
    resourceId: binding.id,
    detail: {
      targetUserId: input.targetUserId,
      workspaceId: input.session.workspaceId,
    },
  })
  // 中文/English: share write path should finish after DB state is durable, not after audit persistence.
  void auditLogTask
  return {
    ok: true as const,
    binding,
  }
}
