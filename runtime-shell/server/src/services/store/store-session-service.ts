import type { Logger } from "../../log"
import * as SessionRepo from "../../repos/session-repo"
import type { BusinessSession, BusinessSessionPatch, SessionEvent, User, Workspace } from "../../types"
import type { PersistState, ReadState } from "./store-domain-support"

export class StoreSessionService {
  constructor(
    private readonly readState: ReadState,
    private readonly persist: PersistState,
    private readonly log: Logger,
  ) {}

  async listSessions() {
    return SessionRepo.listAllSessions()
  }

  async listSessionsByFilter(input: {
    tenantId?: string
    organizationId?: string
    projectId?: string
    workspaceId?: string
    workspaceIds?: string[]
    createdBy?: string
    workerId?: string
    workerIds?: string[]
    statuses?: BusinessSession["status"][]
    limit?: number
  }) {
    return SessionRepo.listSessions(input)
  }

  async countSessions(input: {
    tenantId?: string
    organizationId?: string
    projectId?: string
    workspaceId?: string
    workspaceIds?: string[]
    createdBy?: string
    workerId?: string
    workerIds?: string[]
    statuses?: BusinessSession["status"][]
  }) {
    return SessionRepo.countSessions(input)
  }

  async listUserSessions(user: User) {
    return SessionRepo.listSessionsForUser(user)
  }

  async getSession(sessionId: string) {
    return SessionRepo.findSession(sessionId)
  }

  async createSession(input: {
    title: string
    projectId: string
    workspace: Workspace
    user: User
    workerId: string
  }) {
    const session = await SessionRepo.createSession(input)
    this.log.info("session created", {
      sessionId: session.id,
      title: input.title,
      workspace: input.workspace.rootPath,
    })
    await this.persist()
    return session
  }

  async forkSession(input: { source: BusinessSession; title: string; user: User }) {
    return SessionRepo.forkSession(input)
  }

  async updateSession(sessionId: string, patch: BusinessSessionPatch) {
    return SessionRepo.patchSession(sessionId, patch)
  }

  async softDeleteSessionsByWorkspaceId(input: {
    workspaceId: string
    deletedBy: string
  }) {
    return SessionRepo.softDeleteSessionsByWorkspaceId(input)
  }

  async stageSessionEvent(event: SessionEvent, sessionPatch?: BusinessSessionPatch) {
    return SessionRepo.stageEvent(this.readState(), event, sessionPatch)
  }

  listEvents(sessionId: string, afterEventId?: string) {
    return SessionRepo.listSessionEvents(this.readState(), sessionId, afterEventId)
  }

  async appendEvent(event: SessionEvent) {
    await SessionRepo.stageEvent(this.readState(), event)
    await this.persist()
  }
}
