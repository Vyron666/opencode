import type { User } from "../../types"
import { sessionService, sessionShareService, workspaceService } from "../store/store-singleton"

export async function buildAccessContext(user: User) {
  const scopedWorkspaces = (await workspaceService.listUserWorkspaces(user)).filter((workspace) => {
    // 中文/English: P1-C must derive workspace visibility from explicit user scope,
    // not from organization membership alone.
    return user.projectIds.includes(workspace.projectId) && user.workspaceIds.includes(workspace.id)
  })
  const visibleWorkspaceIds = new Set(scopedWorkspaces.map((workspace) => workspace.id))
  const scopedSessions = (await sessionService.listUserSessions(user)).filter((session) => {
    // 中文/English: session reads stay within both project scope and registered workspace scope.
    return user.projectIds.includes(session.projectId) && visibleWorkspaceIds.has(session.workspaceId)
  })
  const sharedSessions = (
    await Promise.all(
      (await sessionShareService.listSharesForTargetUser(user.id)).map((binding) =>
        sessionService.getSession(binding.businessSessionId),
      ),
    )
  ).filter((session): session is NonNullable<typeof session> => Boolean(session))
  const sessions = [...scopedSessions]
  sharedSessions.forEach((session) => {
    if (sessions.some((item) => item.id === session.id)) return
    sessions.push(session)
  })
  return {
    user,
    tenantId: user.tenantId,
    organizationId: user.organizationId,
    projectIds: new Set(user.projectIds),
    sessions,
    workspaces: scopedWorkspaces,
    sessionIds: new Set(sessions.map((session) => session.id)),
    workspaceIds: visibleWorkspaceIds,
    workerIds: new Set(sessions.map((session) => session.workerId).filter(Boolean)),
  }
}
