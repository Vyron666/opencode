import type { User } from "../../types"
import { auditService, userService, workspaceService, workspaceShareService } from "../store/store-singleton"
import { ensureWorkspaceShareAccessForUser } from "../workspace/workspace-access-service"

export async function createWorkspaceShareForUser(input: {
  user: User
  requestId: string
  workspaceId: string
  projectId: string
  targetUserId: string
}) {
  if (input.user.id === input.targetUserId) {
    return { ok: false as const, reason: "share_target_invalid" }
  }
  const workspaceResult = await ensureWorkspaceShareAccessForUser({
    user: input.user,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    action: "share_workspace",
  })
  if (!workspaceResult.ok) return workspaceResult
  const targetUser = userService.getUser(input.targetUserId)
  if (!targetUser) return { ok: false as const, reason: "target_user_not_found" }
  if (targetUser.tenantId !== input.user.tenantId || targetUser.organizationId !== input.user.organizationId) {
    return { ok: false as const, reason: "forbidden" }
  }
  const binding = await workspaceShareService.createShareBinding({
    workspace: workspaceResult.workspace,
    ownerUserId: input.user.id,
    targetUserId: input.targetUserId,
  })
  const auditLogTask = auditService.appendAuditLog({
    tenantId: workspaceResult.workspace.tenantId,
    organizationId: workspaceResult.workspace.organizationId,
    userId: input.user.id,
    requestId: input.requestId,
    action: "workspace.share",
    resourceType: "workspace_share_binding",
    resourceId: binding.id,
    detail: {
      targetUserId: input.targetUserId,
      workspaceId: workspaceResult.workspace.id,
      projectId: workspaceResult.workspace.projectId,
    },
  })
  void auditLogTask
  return {
    ok: true as const,
    binding,
  }
}

export async function deleteWorkspaceShareForUser(input: {
  user: User
  requestId: string
  workspaceId: string
  projectId: string
  targetUserId: string
}) {
  const workspaceResult = await ensureWorkspaceShareAccessForUser({
    user: input.user,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    action: "unshare_workspace",
  })
  if (!workspaceResult.ok) return workspaceResult
  const revoked = await workspaceShareService.revokeShareBinding({
    workspaceId: workspaceResult.workspace.id,
    targetUserId: input.targetUserId,
    updatedBy: input.user.id,
  })
  if (!revoked) return { ok: false as const, reason: "share_not_found" }

  const auditLogTask = auditService.appendAuditLog({
    tenantId: workspaceResult.workspace.tenantId,
    organizationId: workspaceResult.workspace.organizationId,
    userId: input.user.id,
    requestId: input.requestId,
    action: "workspace.unshare",
    resourceType: "workspace_share_binding",
    resourceId: `${workspaceResult.workspace.id}:${input.targetUserId}`,
    detail: {
      targetUserId: input.targetUserId,
      workspaceId: workspaceResult.workspace.id,
      projectId: workspaceResult.workspace.projectId,
    },
  })
  void auditLogTask

  return { ok: true as const, success: true }
}

export async function listWorkspaceSharesForWorkspace(workspaceId: string) {
  const bindings = await workspaceShareService.listSharesForWorkspace(workspaceId)
  return bindings
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
    .filter((item) => item !== null)
}

export async function getWorkspaceProjectId(workspaceId: string) {
  const workspace = await workspaceService.getWorkspace(workspaceId)
  return workspace?.projectId || ""
}
