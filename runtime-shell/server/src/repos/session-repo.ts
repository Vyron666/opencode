import { now, nextId } from "../store/state-support"
import type { BusinessSession, PersistedState, SessionEvent, User, Workspace } from "../types"
import { getSession, insertSession, listEvents, listSessions, listUserSessions, stageSessionEvent, updateSession } from "./state-repo"

export function listAllSessions(state: PersistedState) {
  return listSessions(state)
}

export function listSessionsForUser(state: PersistedState, user: User) {
  return listUserSessions(state, user)
}

export function findSession(state: PersistedState, sessionId: string) {
  return getSession(state, sessionId)
}

export function createSession(state: PersistedState, input: {
  title: string
  projectId: string
  workspace: Workspace
  user: User
  workerId: string
}) {
  const timestamp = now()
  return insertSession(state, {
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
  })
}

export function forkSession(state: PersistedState, input: { source: BusinessSession; title: string; user: User }) {
  const timestamp = now()
  return insertSession(state, {
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
  })
}

export function patchSession(state: PersistedState, sessionId: string, patch: Partial<BusinessSession>) {
  return updateSession(state, sessionId, {
    ...patch,
    updatedAt: now(),
  })
}

export function stageEvent(state: PersistedState, event: SessionEvent, sessionPatch?: Partial<BusinessSession>) {
  stageSessionEvent(state, event)
  if (!sessionPatch) return
  return patchSession(state, event.businessSessionId, sessionPatch)
}

export function listSessionEvents(state: PersistedState, sessionId: string, afterEventId?: string) {
  return listEvents(state, sessionId, afterEventId)
}
