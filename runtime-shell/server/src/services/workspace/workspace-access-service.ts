import { authorizeWorkspaceAccess } from "../access/authorization-service"
import { workspaceService } from "../store/store-singleton"
import type { BusinessSession, User, Workspace, WorkspaceAccessResult } from "../../types"

export async function ensureWorkspaceForUser(input: {
  user: User
  projectId: string
  workspaceId: string
}): Promise<WorkspaceAccessResult> {
  const workspace = await workspaceService.getWorkspace(input.workspaceId)
  if (!workspace) return { ok: false, reason: "workspace_not_found" }
  return requireWorkspaceWithinScope({
    workspace,
    user: input.user,
    projectId: input.projectId,
    action: "create_session",
  })
}

export async function ensureSessionWorkspaceForUser(input: {
  user: User
  session: BusinessSession
}): Promise<WorkspaceAccessResult> {
  const workspace = await workspaceService.getWorkspace(input.session.workspaceId)
  if (!workspace) return { ok: false, reason: "workspace_not_found" }
  return requireWorkspaceWithinScope({
    workspace,
    user: input.user,
    projectId: input.session.projectId,
    action: "use_for_session",
    businessSession: input.session,
  })
}

function withWorkspacePath(session: BusinessSession, workspace: Workspace) {
  if (session.workspacePath === workspace.rootPath) return session
  // 中文/English: runtime entrypoints must execute against the registered binding path,
  // even if historical session metadata still carries an older workspacePath snapshot.
  return {
    ...session,
    workspacePath: workspace.rootPath,
  }
}

export async function requireRuntimeSessionWorkspace(input: {
  user: User
  session: BusinessSession
}): Promise<
  | {
      ok: true
      session: BusinessSession
      workspace: Workspace
    }
  | Exclude<WorkspaceAccessResult, { ok: true }>
> {
  const workspaceResult = await ensureSessionWorkspaceForUser(input)
  if (!workspaceResult.ok) return workspaceResult
  return {
    ok: true,
    workspace: workspaceResult.workspace,
    session: withWorkspacePath(input.session, workspaceResult.workspace),
  }
}

async function requireWorkspaceWithinScope(input: {
  workspace: Workspace
  user: User
  projectId: string
  action: "use_for_session" | "create_session"
  businessSession?: BusinessSession
}): Promise<WorkspaceAccessResult> {
  const workspace = input.workspace
  const user = input.user
  if (workspace.tenantId !== user.tenantId || workspace.organizationId !== user.organizationId) {
    return { ok: false, reason: "forbidden" }
  }
  if (workspace.projectId !== input.projectId) return { ok: false, reason: "forbidden" }
  if (workspace.status !== "active") return { ok: false, reason: "workspace_disabled" }
  const authorization = await authorizeWorkspaceAccess({
    user,
    workspace,
    projectId: input.projectId,
    action: input.action,
    businessSession: input.businessSession,
  })
  if (!authorization.ok) return { ok: false, reason: "forbidden" }
  const info = await Bun.file(workspace.rootPath).stat().catch(() => null)
  if (!info?.isDirectory()) return { ok: false, reason: "invalid_path" }
  return { ok: true, workspace }
}
