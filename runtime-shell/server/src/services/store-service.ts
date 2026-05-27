import { createLogger } from "../log"
import { ensureDatabaseBootstrap } from "../db/bootstrap"
import type {
  AuditAction,
  BusinessSession,
  SessionEvent,
  User,
  WorkerNode,
  Workspace,
} from "../types"
import { StoreAuditService } from "./store/store-audit-service"
import { StoreAuthService } from "./store/store-auth-service"
import { StoreMetadataService } from "./store/store-metadata-service"
import { StoreSessionService } from "./store/store-session-service"
import { StoreSessionShareService } from "./store/store-session-share-service"
import { StoreStateService } from "./store/store-state-service"
import { StoreUserService } from "./store/store-user-service"
import { StoreWorkerService } from "./store/store-worker-service"
import { StoreWorkspaceService } from "./store/store-workspace-service"

const log = createLogger("store")

export class StoreService {
  readonly stateService = new StoreStateService(log)
  readonly metadataService = new StoreMetadataService(() => this.stateService.readState())
  readonly userService = new StoreUserService(() => this.stateService.readState())
  readonly authService = new StoreAuthService()
  readonly workspaceService = new StoreWorkspaceService()
  readonly workerService = new StoreWorkerService(
    () => this.stateService.readState(),
    () => this.stateService.save(),
  )
  readonly sessionService = new StoreSessionService(
    () => this.stateService.readState(),
    () => this.stateService.save(),
    log,
  )
  readonly sessionShareService = new StoreSessionShareService()
  readonly auditService = new StoreAuditService(() => this.stateService.readState(), () => this.stateService.save())

  async load() {
    await this.stateService.load()
    await ensureDatabaseBootstrap(this.stateService.readState())
  }

  async save() {
    await this.stateService.save()
  }

  listTenants() {
    return this.metadataService.listTenants()
  }

  listOrganizations() {
    return this.metadataService.listOrganizations()
  }

  listUsers() {
    return this.userService.listUsers()
  }

  findUser(username: string, password?: string) {
    return this.userService.findUser(username, password)
  }

  getUser(userId: string) {
    return this.userService.getUser(userId)
  }

  async listAuthSessions() {
    return this.authService.listAuthSessions()
  }

  async createAuthSession(input: {
    user: User
    tokenHash: string
    expiresAt: string
  }) {
    return this.authService.createAuthSession(input)
  }

  async findAuthSession(tokenHash: string) {
    return this.authService.findAuthSession(tokenHash)
  }

  async deleteAuthSession(tokenHash: string) {
    return this.authService.deleteAuthSession(tokenHash)
  }

  async expireAuthSession(tokenHash: string) {
    return this.authService.expireAuthSession(tokenHash)
  }

  async listWorkspaces() {
    return this.workspaceService.listWorkspaces()
  }

  async getWorkspace(workspaceId: string) {
    return this.workspaceService.getWorkspace(workspaceId)
  }

  async findWorkspaceByRootPath(rootPath: string) {
    return this.workspaceService.findWorkspaceByRootPath(rootPath)
  }

  async listUserWorkspaces(user: User) {
    return this.workspaceService.listUserWorkspaces(user)
  }

  async ensureWorkspace(input: {
    tenantId: string
    organizationId: string
    projectId: string
    rootPath: string
    createdBy: string
    name?: string
  }) {
    return this.workspaceService.ensureWorkspace(input)
  }

  listWorkers() {
    return this.workerService.listWorkers()
  }

  async touchWorker(workerId: string, patch?: Partial<WorkerNode>) {
    return this.workerService.touchWorker(workerId, patch)
  }

  async listSessions() {
    return this.sessionService.listSessions()
  }

  async listUserSessions(user: User) {
    return this.sessionService.listUserSessions(user)
  }

  async getSession(sessionId: string) {
    return this.sessionService.getSession(sessionId)
  }

  async createSession(input: {
    title: string
    projectId: string
    workspace: Workspace
    user: User
    workerId: string
  }) {
    return this.sessionService.createSession(input)
  }

  async forkSession(input: { source: BusinessSession; title: string; user: User }) {
    return this.sessionService.forkSession(input)
  }

  async updateSession(sessionId: string, patch: Partial<BusinessSession>) {
    return this.sessionService.updateSession(sessionId, patch)
  }

  async stageSessionEvent(event: SessionEvent, sessionPatch?: Partial<BusinessSession>) {
    return this.sessionService.stageSessionEvent(event, sessionPatch)
  }

  listEvents(sessionId: string, afterEventId?: string) {
    return this.sessionService.listEvents(sessionId, afterEventId)
  }

  async appendEvent(event: SessionEvent) {
    return this.sessionService.appendEvent(event)
  }

  async listSessionSharesForTargetUser(userId: string) {
    return this.sessionShareService.listSharesForTargetUser(userId)
  }

  async findSessionShareForTarget(input: {
    businessSessionId: string
    targetUserId: string
  }) {
    return this.sessionShareService.findShareForSessionTarget(input)
  }

  async createSessionShare(input: {
    session: BusinessSession
    ownerUserId: string
    targetUserId: string
  }) {
    return this.sessionShareService.createShareBinding(input)
  }

  async revokeSessionShare(input: {
    businessSessionId: string
    targetUserId: string
    updatedBy: string
  }) {
    return this.sessionShareService.revokeShareBinding(input)
  }

  listAuditLogs() {
    return this.auditService.listAuditLogs()
  }

  async appendAuditLog(input: {
    tenantId: string
    organizationId: string
    userId?: string
    businessSessionId?: string
    requestId?: string
    action: AuditAction
    resourceType:
      | "auth_session"
      | "workspace"
      | "business_session"
      | "provider_config"
      | "custom_model"
      | "session_share_binding"
    resourceId?: string
    detail: Record<string, unknown>
  }) {
    return this.auditService.appendAuditLog(input)
  }
}
