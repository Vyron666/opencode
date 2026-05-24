import path from "node:path"
import type {
  AuditAction,
  AuditLog,
  AuthSession,
  BusinessSession,
  SessionEvent,
  User,
  WorkerNode,
  Workspace,
} from "./types"
import { createLogger } from "./log"
import { loadStateFromDisk, saveStateToDisk } from "./store/persistence-support"
import { defaultState, nextId, now } from "./store/state-support"

const log = createLogger("store")

export class Store {
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
    return this.state.users
  }

  findUser(username: string, password?: string) {
    const user = this.state.users.find((item) => item.username === username)
    if (!user) return
    if (password !== undefined && user.password !== password) return
    return user
  }

  getUser(userId: string) {
    return this.state.users.find((item) => item.id === userId)
  }

  listAuthSessions() {
    return this.state.authSessions
  }

  async createAuthSession(input: {
    user: User
    tokenHash: string
    expiresAt: string
  }) {
    const timestamp = now()
    const authSession: AuthSession = {
      id: nextId("auth"),
      userId: input.user.id,
      tenantId: input.user.tenantId,
      organizationId: input.user.organizationId,
      tokenHash: input.tokenHash,
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: input.expiresAt,
    }
    this.state.authSessions.push(authSession)
    await this.save()
    return authSession
  }

  findAuthSession(tokenHash: string) {
    return this.state.authSessions.find((item) => item.tokenHash === tokenHash)
  }

  async deleteAuthSession(tokenHash: string) {
    const before = this.state.authSessions.length
    this.state.authSessions = this.state.authSessions.filter((item) => item.tokenHash !== tokenHash)
    if (this.state.authSessions.length === before) return false
    await this.save()
    return true
  }

  listWorkspaces() {
    return this.state.workspaces
  }

  getWorkspace(workspaceId: string) {
    return this.state.workspaces.find((item) => item.id === workspaceId)
  }

  findWorkspaceByRootPath(rootPath: string) {
    return this.state.workspaces.find((item) => item.rootPath === rootPath)
  }

  listUserWorkspaces(user: User) {
    return this.state.workspaces.filter(
      (item) => item.tenantId === user.tenantId && item.organizationId === user.organizationId,
    )
  }

  async ensureWorkspace(input: {
    tenantId: string
    organizationId: string
    projectId: string
    rootPath: string
    createdBy: string
    name?: string
  }) {
    const existing = this.findWorkspaceByRootPath(input.rootPath)
    if (existing) return existing
    const timestamp = now()
    const workspace: Workspace = {
      id: nextId("workspace"),
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      name: input.name || path.basename(input.rootPath) || input.projectId,
      rootPath: input.rootPath,
      createdBy: input.createdBy,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    this.state.workspaces.push(workspace)
    await this.save()
    return workspace
  }

  listWorkers() {
    return this.state.workers
  }

  async touchWorker(workerId: string, patch?: Partial<WorkerNode>) {
    const index = this.state.workers.findIndex((item) => item.id === workerId)
    if (index === -1) return
    this.state.workers[index] = {
      ...this.state.workers[index],
      ...patch,
      lastHeartbeatAt: now(),
    }
    await this.save()
  }

  listSessions() {
    return this.state.sessions.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  listUserSessions(user: User) {
    return this.state.sessions
      .filter((item) => item.tenantId === user.tenantId && item.organizationId === user.organizationId)
      .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  getSession(sessionId: string) {
    return this.state.sessions.find((item) => item.id === sessionId)
  }

  async createSession(input: {
    title: string
    projectId: string
    workspace: Workspace
    user: User
    workerId: string
  }) {
    const timestamp = now()
    const session: BusinessSession = {
      id: nextId("bs"),
      tenantId: input.user.tenantId,
      organizationId: input.user.organizationId,
      workspaceId: input.workspace.id,
      title: input.title,
      projectId: input.projectId,
      workspacePath: input.workspace.rootPath,
      workerId: input.workerId,
      status: "created",
      createdBy: input.user.id,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastEventAt: timestamp,
      capabilityState: {},
    }
    this.state.sessions.push(session)
    log.info("session created", { sessionId: session.id, title: input.title, workspace: input.workspace.rootPath })
    await this.save()
    return session
  }

  async forkSession(input: { source: BusinessSession; title: string; user: User }) {
    const timestamp = now()
    const session: BusinessSession = {
      id: nextId("bs"),
      tenantId: input.source.tenantId,
      organizationId: input.source.organizationId,
      workspaceId: input.source.workspaceId,
      title: input.title,
      projectId: input.source.projectId,
      workspacePath: input.source.workspacePath,
      workerId: input.source.workerId,
      status: "created",
      createdBy: input.user.id,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastEventAt: timestamp,
      capabilityState: {
        modelId: input.source.capabilityState?.modelId,
        modeId: input.source.capabilityState?.modeId,
        configOptions: input.source.capabilityState?.configOptions,
        models: input.source.capabilityState?.models,
        modes: input.source.capabilityState?.modes,
        sessionInfo: input.source.capabilityState?.sessionInfo,
        usage: input.source.capabilityState?.usage,
        availableCommands: input.source.capabilityState?.availableCommands,
      },
    }
    this.state.sessions.push(session)
    await this.save()
    return session
  }

  async updateSession(sessionId: string, patch: Partial<BusinessSession>) {
    const session = this.getSession(sessionId)
    if (!session) return
    Object.assign(session, patch, { updatedAt: now() })
    await this.save()
    return session
  }

  stageSessionEvent(event: SessionEvent, sessionPatch?: Partial<BusinessSession>) {
    this.state.events.push(event)
    if (!sessionPatch) return
    const session = this.getSession(event.businessSessionId)
    if (!session) return
    Object.assign(session, sessionPatch, { updatedAt: now() })
    return session
  }

  listEvents(sessionId: string, afterEventId?: string) {
    const items = this.state.events.filter((item) => item.businessSessionId === sessionId)
    if (!afterEventId) return items
    const index = items.findIndex((item) => item.eventId === afterEventId)
    if (index === -1) return items
    return items.slice(index + 1)
  }

  async appendEvent(event: SessionEvent) {
    this.state.events.push(event)
    await this.save()
  }

  listAuditLogs() {
    return this.state.auditLogs.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
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
    const auditLog: AuditLog = {
      id: nextId("audit"),
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      userId: input.userId,
      businessSessionId: input.businessSessionId,
      requestId: input.requestId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      detail: input.detail,
      createdAt: now(),
    }
    this.state.auditLogs.push(auditLog)
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

export const store = new Store()
