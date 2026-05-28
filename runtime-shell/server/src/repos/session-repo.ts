import { getRuntimeDatabaseClient } from "../db/runtime-db"
import { now, nextId } from "../store/state-support"
import type { BusinessSession, BusinessSessionPatch, PersistedState, SessionEvent, User, Workspace } from "../types"
import { listEvents, stageSessionEvent } from "./state-repo"

type SessionRow = {
  id: string
  tenant_id: string
  organization_id: string
  project_id: string
  workspace_binding_id: string
  worker_node_id: string | null
  title: string
  status: BusinessSession["status"]
  created_by: string
  workspace_path: string
  last_event_at: string | null
  created_at: string
  updated_at: string
  binding_json: string | null
  capability_state_json: string | null
}

function parseJson<T>(value: string | null | undefined): T | undefined {
  if (!value) return
  return JSON.parse(value) as T
}

function toBusinessSession(row: SessionRow): BusinessSession {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_binding_id,
    title: row.title,
    projectId: row.project_id,
    workspacePath: row.workspace_path,
    workerId: row.worker_node_id || "",
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastEventAt: row.last_event_at || undefined,
    binding: parseJson(row.binding_json),
    capabilityState: parseJson(row.capability_state_json) || {},
  }
}

function stringifyJson(value: unknown) {
  return JSON.stringify(value ?? {})
}

export async function listAllSessions() {
  const db = getRuntimeDatabaseClient()
  const rows = await db.queryRows<SessionRow>(
    `
      SELECT
        id,
        tenant_id,
        organization_id,
        project_id,
        workspace_binding_id,
        worker_node_id,
        title,
        status,
        created_by,
        workspace_path,
        last_event_at,
        created_at,
        updated_at,
        binding_json,
        capability_state_json
      FROM business_session
      WHERE deleted_at IS NULL
      ORDER BY updated_at DESC
    `,
  )
  return rows.map(toBusinessSession)
}

export async function listSessionsForUser(user: User) {
  const db = getRuntimeDatabaseClient()
  const rows = await db.queryRows<SessionRow>(
    `
      SELECT
        id,
        tenant_id,
        organization_id,
        project_id,
        workspace_binding_id,
        worker_node_id,
        title,
        status,
        created_by,
        workspace_path,
        last_event_at,
        created_at,
        updated_at,
        binding_json,
        capability_state_json
      FROM business_session
      WHERE tenant_id = ?
        AND organization_id = ?
        AND deleted_at IS NULL
      ORDER BY updated_at DESC
    `,
    [user.tenantId, user.organizationId],
  )
  return rows.map(toBusinessSession)
}

export async function findSession(sessionId: string) {
  const db = getRuntimeDatabaseClient()
  const row = await db.queryFirst<SessionRow>(
    `
      SELECT
        id,
        tenant_id,
        organization_id,
        project_id,
        workspace_binding_id,
        worker_node_id,
        title,
        status,
        created_by,
        workspace_path,
        last_event_at,
        created_at,
        updated_at,
        binding_json,
        capability_state_json
      FROM business_session
      WHERE id = ?
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [sessionId],
  )
  if (!row) return
  return toBusinessSession(row)
}

export async function createSession(input: {
  title: string
  projectId: string
  workspace: Workspace
  user: User
  workerId: string
}) {
  const db = getRuntimeDatabaseClient()
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
  await db.execute(
    `
      INSERT INTO business_session (
        id,
        tenant_id,
        organization_id,
        project_id,
        workspace_binding_id,
        worker_node_id,
        title,
        status,
        created_by,
        workspace_path,
        last_event_at,
        created_at,
        updated_at,
        updated_by,
        deleted_at,
        binding_json,
        capability_state_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      session.id,
      session.tenantId,
      session.organizationId,
      session.projectId,
      session.workspaceId,
      session.workerId,
      session.title,
      session.status,
      session.createdBy,
      session.workspacePath,
      session.lastEventAt || null,
      session.createdAt,
      session.updatedAt,
      session.createdBy,
      null,
      null,
      stringifyJson(session.capabilityState),
    ],
  )
  return session
}

export async function forkSession(input: { source: BusinessSession; title: string; user: User }) {
  const db = getRuntimeDatabaseClient()
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
  await db.execute(
    `
      INSERT INTO business_session (
        id,
        tenant_id,
        organization_id,
        project_id,
        workspace_binding_id,
        worker_node_id,
        title,
        status,
        created_by,
        workspace_path,
        last_event_at,
        created_at,
        updated_at,
        updated_by,
        deleted_at,
        binding_json,
        capability_state_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      session.id,
      session.tenantId,
      session.organizationId,
      session.projectId,
      session.workspaceId,
      session.workerId,
      session.title,
      session.status,
      session.createdBy,
      session.workspacePath,
      session.lastEventAt || null,
      session.createdAt,
      session.updatedAt,
      session.createdBy,
      null,
      session.binding ? stringifyJson(session.binding) : null,
      stringifyJson(session.capabilityState),
    ],
  )
  return session
}

export async function patchSession(sessionId: string, patch: BusinessSessionPatch) {
  const current = await findSession(sessionId)
  if (!current) return
  const session: BusinessSession = {
    ...current,
    ...patch,
    updatedAt: now(),
    capabilityState: patch.capabilityState === undefined ? current.capabilityState : patch.capabilityState,
    binding: patch.binding === undefined ? current.binding : patch.binding || undefined,
  }
  const db = getRuntimeDatabaseClient()
  const updates = [
    patch.workspaceId !== undefined ? ["workspace_binding_id = ?", session.workspaceId] : null,
    patch.workerId !== undefined ? ["worker_node_id = ?", session.workerId] : null,
    patch.title !== undefined ? ["title = ?", session.title] : null,
    patch.status !== undefined ? ["status = ?", session.status] : null,
    patch.workspacePath !== undefined ? ["workspace_path = ?", session.workspacePath] : null,
    patch.lastEventAt !== undefined ? ["last_event_at = ?", session.lastEventAt || null] : null,
    patch.binding !== undefined ? ["binding_json = ?", session.binding ? stringifyJson(session.binding) : null] : null,
    patch.capabilityState !== undefined
      ? ["capability_state_json = ?", stringifyJson(session.capabilityState)]
      : null,
    ["updated_at = ?", session.updatedAt],
    ["updated_by = ?", session.createdBy],
  ].filter((item): item is [string, string | null] => Boolean(item))
  await db.execute(
    `
      UPDATE business_session
      SET
        ${updates.map((item) => item[0]).join(",\n        ")}
      WHERE id = ?
        AND deleted_at IS NULL
    `,
    [
      ...updates.map((item) => item[1]),
      session.id,
    ],
  )
  return session
}

export async function stageEvent(state: PersistedState, event: SessionEvent, sessionPatch?: BusinessSessionPatch) {
  stageSessionEvent(state, event)
  if (!sessionPatch) return
  return patchSession(event.businessSessionId, sessionPatch)
}

export function listSessionEvents(state: PersistedState, sessionId: string, afterEventId?: string) {
  return listEvents(state, sessionId, afterEventId)
}
