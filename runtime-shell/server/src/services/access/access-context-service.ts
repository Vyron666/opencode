import type { User } from "../../types"
import { sessionService, workspaceService, workspaceShareService } from "../store/store-singleton"

export async function buildAccessContext(user: User) {
  const allWorkspaces = await workspaceService.listUserWorkspaces(user)
  const scopedWorkspaces = allWorkspaces.filter((workspace) => {
    // 中文/English: direct workspace visibility still comes from the user's own scoped bindings.
    if (user.role === "admin") return true
    if (user.role !== "developer") return false
    return user.projectIds.includes(workspace.projectId) && workspace.createdBy === user.id
  })
  const workspaceShareBindings = await workspaceShareService.listSharesForTargetUser(user.id)
  const sharedWorkspaceIds = new Set(workspaceShareBindings.map((binding) => binding.workspaceId))
  const sharedWorkspaces = allWorkspaces.filter((workspace) => sharedWorkspaceIds.has(workspace.id))
  const workspaceMap = new Map<string, (typeof allWorkspaces)[number]>()
  scopedWorkspaces.forEach((workspace) => workspaceMap.set(workspace.id, workspace))
  sharedWorkspaces.forEach((workspace) => workspaceMap.set(workspace.id, workspace))
  const workspaces = [...workspaceMap.values()]
  const visibleWorkspaceIds = new Set(workspaces.map((workspace) => workspace.id))
  const visibleProjectIds = new Set(workspaces.map((workspace) => workspace.projectId))
  const sessions = (await sessionService.listUserSessions(user)).filter((session) => {
    if (!visibleWorkspaceIds.has(session.workspaceId)) return false
    if (!visibleProjectIds.has(session.projectId)) return false
    if (user.role === "admin") return true
    if (session.createdBy === user.id) return true
    return sharedWorkspaceIds.has(session.workspaceId)
  })
  return {
    user,
    tenantId: user.tenantId,
    organizationId: user.organizationId,
    projectIds: visibleProjectIds,
    sessions,
    workspaces,
    sessionIds: new Set(sessions.map((session) => session.id)),
    workspaceIds: visibleWorkspaceIds,
    workerIds: new Set(sessions.map((session) => session.workerId).filter(Boolean)),
    sharedWorkspaceIds,
  }
}
