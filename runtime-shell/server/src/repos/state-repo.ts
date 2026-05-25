import type {
  AuthSession,
  AuditLog,
  BusinessSession,
  PersistedState,
  SessionEvent,
  User,
  WorkerNode,
  Workspace,
} from "../types"

export function listUsers(state: PersistedState) {
  return state.users
}

export function findUser(state: PersistedState, username: string, password?: string) {
  const user = state.users.find((item) => item.username === username)
  if (!user) return
  if (password !== undefined && user.password !== password) return
  return user
}

export function getUser(state: PersistedState, userId: string) {
  return state.users.find((item) => item.id === userId)
}

export function listAuthSessions(state: PersistedState) {
  return state.authSessions
}

export function findAuthSession(state: PersistedState, tokenHash: string) {
  return state.authSessions.find((item) => item.tokenHash === tokenHash)
}

export function deleteAuthSession(state: PersistedState, tokenHash: string) {
  const before = state.authSessions.length
  state.authSessions = state.authSessions.filter((item) => item.tokenHash !== tokenHash)
  return state.authSessions.length !== before
}

export function insertAuthSession(state: PersistedState, authSession: AuthSession) {
  state.authSessions.push(authSession)
  return authSession
}

export function listWorkspaces(state: PersistedState) {
  return state.workspaces
}

export function getWorkspace(state: PersistedState, workspaceId: string) {
  return state.workspaces.find((item) => item.id === workspaceId)
}

export function findWorkspaceByRootPath(state: PersistedState, rootPath: string) {
  return state.workspaces.find((item) => item.rootPath === rootPath)
}

export function listUserWorkspaces(state: PersistedState, user: User) {
  return state.workspaces.filter(
    (item) => item.tenantId === user.tenantId && item.organizationId === user.organizationId,
  )
}

export function insertWorkspace(state: PersistedState, workspace: Workspace) {
  state.workspaces.push(workspace)
  return workspace
}

export function listWorkers(state: PersistedState) {
  return state.workers
}

export function updateWorker(state: PersistedState, workerId: string, patch: Partial<WorkerNode>) {
  const index = state.workers.findIndex((item) => item.id === workerId)
  if (index === -1) return
  state.workers[index] = {
    ...state.workers[index],
    ...patch,
  }
  return state.workers[index]
}

export function listSessions(state: PersistedState) {
  return state.sessions.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function listUserSessions(state: PersistedState, user: User) {
  return state.sessions
    .filter((item) => item.tenantId === user.tenantId && item.organizationId === user.organizationId)
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function getSession(state: PersistedState, sessionId: string) {
  return state.sessions.find((item) => item.id === sessionId)
}

export function insertSession(state: PersistedState, session: BusinessSession) {
  state.sessions.push(session)
  return session
}

export function updateSession(state: PersistedState, sessionId: string, patch: Partial<BusinessSession>) {
  const session = getSession(state, sessionId)
  if (!session) return
  Object.assign(session, patch)
  return session
}

export function stageSessionEvent(state: PersistedState, event: SessionEvent) {
  state.events.push(event)
  return event
}

export function listEvents(state: PersistedState, sessionId: string, afterEventId?: string) {
  const items = state.events.filter((item) => item.businessSessionId === sessionId)
  if (!afterEventId) return items
  const index = items.findIndex((item) => item.eventId === afterEventId)
  if (index === -1) return items
  return items.slice(index + 1)
}

export function listAuditLogs(state: PersistedState) {
  return state.auditLogs.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function insertAuditLog(state: PersistedState, auditLog: AuditLog) {
  state.auditLogs.push(auditLog)
  return auditLog
}
