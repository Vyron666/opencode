import type {
  AuditAction,
  BusinessSession,
  PersistedState,
  SessionEvent,
  User,
  WorkerNode,
  Workspace,
} from "../types"
import { createLogger } from "../log"
import { loadStateFromDisk, saveStateToDisk } from "../store/persistence-support"
import { defaultState } from "../store/state-support"
import * as AuditRepo from "../repos/audit-repo"
import * as AuthRepo from "../repos/auth-repo"
import * as SessionRepo from "../repos/session-repo"
import * as UserRepo from "../repos/user-repo"
import * as WorkerRepo from "../repos/worker-repo"
import * as WorkspaceRepo from "../repos/workspace-repo"

const log = createLogger("store")

export class StoreService {
  private state = defaultState()
  private writeQueue = Promise.resolve()

  async load() {
    this.state = await loadStateFromDisk(log)
  }

  async save() {
    await this.enqueueWrite(() => saveStateToDisk(this.state))
  }

  listTenants() {
    return this.state.tenants
  }

  listOrganizations() {
    return this.state.organizations
  }

  listUsers() {
    return UserRepo.listAllUsers(this.state)
  }

  findUser(username: string, password?: string) {
    return UserRepo.findUserByCredentials(this.state, username, password)
  }

  getUser(userId: string) {
    return UserRepo.findUserById(this.state, userId)
  }

  listAuthSessions() {
    return AuthRepo.listSessions(this.state)
  }

  async createAuthSession(input: {
    user: User
    tokenHash: string
    expiresAt: string
  }) {
    const authSession = AuthRepo.createSession(this.state, input)
    await this.save()
    return authSession
  }

  findAuthSession(tokenHash: string) {
    return AuthRepo.findSession(this.state, tokenHash)
  }

  async deleteAuthSession(tokenHash: string) {
    const deleted = AuthRepo.removeSession(this.state, tokenHash)
    if (!deleted) return false
    await this.save()
    return true
  }

  listWorkspaces() {
    return WorkspaceRepo.listAllWorkspaces(this.state)
  }

  getWorkspace(workspaceId: string) {
    return WorkspaceRepo.findWorkspace(this.state, workspaceId)
  }

  findWorkspaceByRootPath(rootPath: string) {
    return WorkspaceRepo.findWorkspaceByPath(this.state, rootPath)
  }

  listUserWorkspaces(user: User) {
    return WorkspaceRepo.listWorkspacesForUser(this.state, user)
  }

  async ensureWorkspace(input: {
    tenantId: string
    organizationId: string
    projectId: string
    rootPath: string
    createdBy: string
    name?: string
  }) {
    const workspace = WorkspaceRepo.ensureWorkspace(this.state, input)
    await this.save()
    return workspace
  }

  listWorkers() {
    return WorkerRepo.listAllWorkers(this.state)
  }

  async touchWorker(workerId: string, patch?: Partial<WorkerNode>) {
    const worker = WorkerRepo.touchWorker(this.state, workerId, patch)
    if (!worker) return
    await this.save()
  }

  listSessions() {
    return SessionRepo.listAllSessions(this.state)
  }

  listUserSessions(user: User) {
    return SessionRepo.listSessionsForUser(this.state, user)
  }

  getSession(sessionId: string) {
    return SessionRepo.findSession(this.state, sessionId)
  }

  async createSession(input: {
    title: string
    projectId: string
    workspace: Workspace
    user: User
    workerId: string
  }) {
    const session = SessionRepo.createSession(this.state, input)
    log.info("session created", { sessionId: session.id, title: input.title, workspace: input.workspace.rootPath })
    await this.save()
    return session
  }

  async forkSession(input: { source: BusinessSession; title: string; user: User }) {
    const session = SessionRepo.forkSession(this.state, input)
    await this.save()
    return session
  }

  async updateSession(sessionId: string, patch: Partial<BusinessSession>) {
    const session = SessionRepo.patchSession(this.state, sessionId, patch)
    if (!session) return
    await this.save()
    return session
  }

  stageSessionEvent(event: SessionEvent, sessionPatch?: Partial<BusinessSession>) {
    return SessionRepo.stageEvent(this.state, event, sessionPatch)
  }

  listEvents(sessionId: string, afterEventId?: string) {
    return SessionRepo.listSessionEvents(this.state, sessionId, afterEventId)
  }

  async appendEvent(event: SessionEvent) {
    SessionRepo.stageEvent(this.state, event)
    await this.save()
  }

  listAuditLogs() {
    return AuditRepo.listAllAuditLogs(this.state)
  }

  async appendAuditLog(input: {
    tenantId: string
    organizationId: string
    userId?: string
    businessSessionId?: string
    requestId?: string
    action: AuditAction
    resourceType: "auth_session" | "workspace" | "business_session" | "provider_config"
    resourceId?: string
    detail: Record<string, unknown>
  }) {
    const auditLog = AuditRepo.appendAuditLog(this.state, input)
    await this.save()
    return auditLog
  }

  private enqueueWrite<T>(task: () => Promise<T>) {
    const next = this.writeQueue.then(task, task)
    this.writeQueue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }
}
