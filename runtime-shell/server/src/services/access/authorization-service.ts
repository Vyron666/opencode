import type { BusinessSession, User, Workspace } from "../../types"
import { workspaceShareService } from "../store/store-singleton"

export type SessionAction =
  | "read"
  | "open"
  | "load"
  | "resume"
  | "prompt"
  | "cancel"
  | "respond_permission"
  | "respond_question"
  | "close"
  | "fork"
  | "share_create"
  | "share_delete"
  | "mode_update"
  | "model_update"
  | "config_update"

export type WorkspaceAction = "use_for_session" | "create_session" | "share_workspace" | "unshare_workspace"
export type SettingsAction = "list" | "save"
type SessionAuthorizationFailureReason = "forbidden" | "workspace_not_shared" | "share_revoked"
type WorkspaceAuthorizationFailureReason = "forbidden" | "scope_mismatch" | "workspace_not_shared" | "share_revoked"
type SessionAuthorizationResult =
  | { ok: true; via: "admin" | "owner" | "workspace_share" }
  | { ok: false; reason: SessionAuthorizationFailureReason }
type WorkspaceAuthorizationResult =
  | { ok: true; via: "admin" | "scope" | "workspace_share" }
  | { ok: false; reason: WorkspaceAuthorizationFailureReason }

export async function authorizeSessionAction(input: {
  user: User
  session: BusinessSession
  action: SessionAction
}): Promise<SessionAuthorizationResult> {
  if (input.user.role === "admin") return { ok: true as const, via: "admin" as const }
  if (input.user.role !== "developer") return { ok: false as const, reason: "forbidden" }
  if (input.session.createdBy === input.user.id) {
    return authorizeOwnerSessionAction(input.action)
  }

  const workspaceShare = await workspaceShareService.findShareForWorkspaceTarget({
    workspaceId: input.session.workspaceId,
    targetUserId: input.user.id,
  })
  if (!workspaceShare) {
    return { ok: false as const, reason: "workspace_not_shared" }
  }
  if (workspaceShare.status !== "active") {
    return { ok: false as const, reason: "share_revoked" }
  }
  return authorizeWorkspaceSharedSessionAction(input.action)
}

export async function authorizeWorkspaceAccess(input: {
  user: User
  workspace: Workspace
  projectId: string
  action: WorkspaceAction
  businessSession?: BusinessSession
}): Promise<WorkspaceAuthorizationResult> {
  if (input.user.role === "admin") return { ok: true as const, via: "admin" as const }
  if (input.user.role !== "developer") return { ok: false as const, reason: "forbidden" }

  const inDirectScope =
    input.user.projectIds.includes(input.projectId) && input.workspace.createdBy === input.user.id

  if (input.action === "create_session") {
    if (inDirectScope) return { ok: true as const, via: "scope" as const }
    return { ok: false as const, reason: "scope_mismatch" }
  }

  if (input.action === "share_workspace" || input.action === "unshare_workspace") {
    if (inDirectScope && input.workspace.createdBy === input.user.id) {
      return { ok: true as const, via: "scope" as const }
    }
    return { ok: false as const, reason: "scope_mismatch" }
  }

  if (input.businessSession?.createdBy === input.user.id && inDirectScope) {
    return { ok: true as const, via: "scope" as const }
  }

  const workspaceShare = await workspaceShareService.findShareForWorkspaceTarget({
    workspaceId: input.workspace.id,
    targetUserId: input.user.id,
  })
  if (!workspaceShare) {
    return { ok: false as const, reason: "workspace_not_shared" }
  }
  if (workspaceShare.status !== "active") {
    return { ok: false as const, reason: "share_revoked" }
  }
  return { ok: true as const, via: "workspace_share" as const }
}

export function authorizeSystemWorkersAccess(user: User) {
  if (user.role === "admin") return { ok: true as const }
  return { ok: false as const, reason: "forbidden" }
}

export function authorizeSettingsAction(input: {
  user: User
  resource: "custom_model" | "provider_config"
  action: SettingsAction
}) {
  if (input.action === "list") {
    if (input.user.role === "admin" || input.user.role === "developer") return { ok: true as const }
    return { ok: false as const, reason: "forbidden" }
  }
  if (input.user.role === "admin") return { ok: true as const }
  return { ok: false as const, reason: "forbidden" }
}

function authorizeOwnerSessionAction(action: SessionAction): SessionAuthorizationResult {
  if (
    action === "read" ||
    action === "open" ||
    action === "load" ||
    action === "resume" ||
    action === "prompt" ||
    action === "cancel" ||
    action === "respond_permission" ||
    action === "respond_question" ||
    action === "close" ||
    action === "fork" ||
    action === "share_create" ||
    action === "share_delete" ||
    action === "mode_update" ||
    action === "model_update" ||
    action === "config_update"
  ) {
    return { ok: true as const, via: "owner" as const }
  }
  return { ok: false as const, reason: "forbidden" }
}

function authorizeWorkspaceSharedSessionAction(action: SessionAction): SessionAuthorizationResult {
  if (
    action === "read" ||
    action === "open" ||
    action === "load" ||
    action === "resume" ||
    action === "prompt" ||
    action === "cancel" ||
    action === "respond_permission" ||
    action === "respond_question"
  ) {
    return { ok: true as const, via: "workspace_share" as const }
  }
  return { ok: false as const, reason: "forbidden" }
}
