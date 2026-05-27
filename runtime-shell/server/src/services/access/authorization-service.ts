import type { BusinessSession, User, Workspace } from "../../types"
import { sessionShareService } from "../store/store-singleton"

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

export type WorkspaceAction = "use_for_session" | "create_session"
export type SettingsAction = "list" | "save"

export async function authorizeSessionAction(input: {
  user: User
  session: BusinessSession
  action: SessionAction
}) {
  if (input.user.role === "admin") return { ok: true as const, via: "admin" as const }
  if (input.user.role !== "developer") return { ok: false as const, reason: "forbidden" }
  if (input.session.createdBy === input.user.id) {
    return authorizeOwnerSessionAction(input.action)
  }

  const shareBinding = await sessionShareService.findShareForSessionTarget({
    businessSessionId: input.session.id,
    targetUserId: input.user.id,
  })
  if (!shareBinding || shareBinding.status !== "active") {
    return { ok: false as const, reason: "forbidden" }
  }
  return authorizeSharedSessionAction(input.action)
}

export async function authorizeWorkspaceAccess(input: {
  user: User
  workspace: Workspace
  projectId: string
  action: WorkspaceAction
  businessSession?: BusinessSession
}) {
  if (input.user.role === "admin") return { ok: true as const, via: "admin" as const }
  if (input.user.role !== "developer") return { ok: false as const, reason: "forbidden" }

  if (input.action === "create_session") {
    if (input.user.projectIds.includes(input.projectId) && input.user.workspaceIds.includes(input.workspace.id)) {
      return { ok: true as const, via: "scope" as const }
    }
    return { ok: false as const, reason: "forbidden" }
  }

  if (input.businessSession && input.businessSession.createdBy === input.user.id) {
    if (input.user.projectIds.includes(input.projectId) && input.user.workspaceIds.includes(input.workspace.id)) {
      return { ok: true as const, via: "scope" as const }
    }
  }

  if (!input.businessSession) return { ok: false as const, reason: "forbidden" }
  const shareBinding = await sessionShareService.findShareForSessionTarget({
    businessSessionId: input.businessSession.id,
    targetUserId: input.user.id,
  })
  if (!shareBinding || shareBinding.status !== "active") {
    return { ok: false as const, reason: "forbidden" }
  }
  if (shareBinding.workspaceId !== input.workspace.id) {
    return { ok: false as const, reason: "forbidden" }
  }
  return { ok: true as const, via: "share" as const }
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

function authorizeOwnerSessionAction(action: SessionAction) {
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

function authorizeSharedSessionAction(action: SessionAction) {
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
    return { ok: true as const, via: "share" as const }
  }
  return { ok: false as const, reason: "forbidden" }
}
