import { closeRuntime } from "../../acp-runtime-manager"
import type { BusinessSession, User } from "../../types"
import { buildAccessContext } from "../access/access-context-service"
import { ensureWorkspaceForUser, requireSessionAction } from "./session-access-service"
import { resetSessionRuntime } from "./session-lifecycle-service"
import { openSessionWithFallback } from "./session-runtime-service"
import { sessionSummary } from "./session-summary-service"
import { requireRuntimeSessionWorkspace } from "../workspace/workspace-access-service"
import { auditService, sessionService, sessionShareService, userService, workerService } from "../store/store-singleton"

export async function listUserSessionOverview(user: User) {
  const context = await buildAccessContext(user)
  return {
    items: context.sessions.map(sessionSummary),
    workspaces: context.workspaces,
  }
}

export async function createSessionForUser(input: {
  user: User
  requestId: string
  title: string
  projectId: string
  workspaceId: string
}) {
  const worker = workerService.listWorkers()[0]
  if (!worker) return { ok: false as const, reason: "worker_not_found" }

  const workspaceResult = await ensureWorkspaceForUser({
    user: input.user,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
  })
  if (!workspaceResult.ok) return workspaceResult

  const session = await sessionService.createSession({
    title: input.title,
    projectId: input.projectId,
    workspace: workspaceResult.workspace,
    user: input.user,
    workerId: worker.id,
  })
  const auditLogTask = auditService.appendAuditLog({
    tenantId: input.user.tenantId,
    organizationId: input.user.organizationId,
    userId: input.user.id,
    businessSessionId: session.id,
    requestId: input.requestId,
    action: "session.create",
    resourceType: "business_session",
    resourceId: session.id,
    detail: {
      title: session.title,
      workspaceId: workspaceResult.workspace.id,
      workspacePath: workspaceResult.workspace.rootPath,
    },
  })
  // 中文/English: session creation must not wait for audit durability before responding.
  void auditLogTask

  return {
    ok: true as const,
    session: sessionSummary(session),
  }
}

export async function getSessionDetailForUser(input: {
  user: User
  businessSessionId: string
}) {
  const result = await requireSessionAction({
    user: input.user,
    sessionId: input.businessSessionId,
    action: "read",
  })
  if (!result.ok) return result
  const shares = await sessionShareService.listSharesForSession(result.session.id)
  return {
    ok: true as const,
    session: sessionSummary(result.session),
    events: sessionService.listEvents(result.session.id),
    shares: shares
      .map((binding) => {
        const targetUser = userService.getUser(binding.targetUserId)
        if (!targetUser) return null
        return {
          id: binding.id,
          targetUserId: binding.targetUserId,
          targetDisplayName: targetUser.displayName || targetUser.username,
          targetRole: targetUser.role,
          status: binding.status,
        }
      })
      .filter((item) => item !== null),
  }
}

export async function closeSessionForUser(input: {
  user: User
  requestId: string
  businessSessionId: string
}) {
  const result = await requireSessionAction({
    user: input.user,
    sessionId: input.businessSessionId,
    action: "close",
  })
  if (!result.ok) return result

  const closedReal = await closeRuntime(result.session.id)
  const closed = await resetSessionRuntime(result.session.id, "completed")
  const auditLogTask = auditService.appendAuditLog({
    tenantId: result.session.tenantId,
    organizationId: result.session.organizationId,
    userId: input.user.id,
    businessSessionId: result.session.id,
    requestId: input.requestId,
    action: "session.close",
    resourceType: "business_session",
    resourceId: result.session.id,
    detail: {
      closedReal,
    },
  })
  // 中文/English: closing should update the UI immediately; audit continues in background.
  void auditLogTask

  return {
    ok: true as const,
    session: sessionSummary(closed || result.session),
  }
}

export async function openSessionForUser(input: {
  user: User
  requestId: string
  businessSessionId: string
}) {
  const result = await requireSessionAction({
    user: input.user,
    sessionId: input.businessSessionId,
    action: "open",
  })
  if (!result.ok) return result

  const workspaceResult = await requireRuntimeSessionWorkspace({
    user: input.user,
    session: result.session,
  })
  if (!workspaceResult.ok) return workspaceResult

  const opened = await openSessionWithFallback(workspaceResult.session)
  if (!opened) return { ok: false as const, reason: "open_failed" }

  const auditLogTask = auditService.appendAuditLog({
    tenantId: opened.tenantId,
    organizationId: opened.organizationId,
    userId: input.user.id,
    businessSessionId: opened.id,
    requestId: input.requestId,
    action: "session.open",
    resourceType: "business_session",
    resourceId: opened.id,
    detail: {},
  })
  // 中文/English: runtime open should not block on audit persistence.
  void auditLogTask

  return {
    ok: true as const,
    session: sessionSummary(opened),
  }
}

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
  return await createSessionShareForValidatedUser({
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
