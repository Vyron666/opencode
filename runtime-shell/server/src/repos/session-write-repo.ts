import { getRuntimeDatabaseClient } from "../db/runtime-db"
import { now, nextId } from "../store/state-support"
import type { BusinessSession, BusinessSessionPatch, User, Workspace } from "../types"
import { findSession } from "./session-query-repo"
import { stringifySessionJson } from "./session-row-mappers"

export async function createSession(input: {
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
    clientConnectedCount: 0,
    capabilityState: {},
  }
  await getRuntimeDatabaseClient().execute(
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
        client_connected_count,
        last_client_seen_at,
        last_client_disconnected_at,
        created_at,
        updated_at,
        updated_by,
        deleted_at,
        binding_json,
        capability_state_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      session.clientConnectedCount || 0,
      session.lastClientSeenAt || null,
      session.lastClientDisconnectedAt || null,
      session.createdAt,
      session.updatedAt,
      session.createdBy,
      null,
      null,
      stringifySessionJson(session.capabilityState),
    ],
  )
  return session
}

export async function forkSession(input: { source: BusinessSession; title: string; user: User }) {
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
    clientConnectedCount: 0,
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
  await getRuntimeDatabaseClient().execute(
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
        client_connected_count,
        last_client_seen_at,
        last_client_disconnected_at,
        created_at,
        updated_at,
        updated_by,
        deleted_at,
        binding_json,
        capability_state_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      session.clientConnectedCount || 0,
      session.lastClientSeenAt || null,
      session.lastClientDisconnectedAt || null,
      session.createdAt,
      session.updatedAt,
      session.createdBy,
      null,
      session.binding ? stringifySessionJson(session.binding) : null,
      stringifySessionJson(session.capabilityState),
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
  const updates: Array<[string, string | null]> = []
  if (patch.workspaceId !== undefined) updates.push(["workspace_binding_id = ?", session.workspaceId])
  if (patch.workerId !== undefined) updates.push(["worker_node_id = ?", session.workerId])
  if (patch.title !== undefined) updates.push(["title = ?", session.title])
  if (patch.status !== undefined) updates.push(["status = ?", session.status])
  if (patch.workspacePath !== undefined) updates.push(["workspace_path = ?", session.workspacePath])
  if (patch.lastEventAt !== undefined) updates.push(["last_event_at = ?", session.lastEventAt || null])
  if (patch.clientConnectedCount !== undefined) updates.push(["client_connected_count = ?", String(session.clientConnectedCount || 0)])
  if (patch.lastClientSeenAt !== undefined) updates.push(["last_client_seen_at = ?", session.lastClientSeenAt || null])
  if (patch.lastClientDisconnectedAt !== undefined) {
    updates.push(["last_client_disconnected_at = ?", session.lastClientDisconnectedAt || null])
  }
  if (patch.binding !== undefined) {
    updates.push(["binding_json = ?", session.binding ? stringifySessionJson(session.binding) : null])
  }
  if (patch.capabilityState !== undefined) {
    updates.push(["capability_state_json = ?", stringifySessionJson(session.capabilityState)])
  }
  updates.push(["updated_at = ?", session.updatedAt])
  updates.push(["updated_by = ?", session.createdBy])
  await getRuntimeDatabaseClient().execute(
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

export async function markSessionClientConnected(sessionId: string, timestamp: string) {
  await getRuntimeDatabaseClient().execute(
    `
      UPDATE business_session
      SET
        client_connected_count = client_connected_count + 1,
        last_client_seen_at = ?,
        updated_at = ?,
        last_client_disconnected_at = CASE
          WHEN client_connected_count + 1 > 0 THEN NULL
          ELSE last_client_disconnected_at
        END
      WHERE id = ?
        AND deleted_at IS NULL
    `,
    [timestamp, timestamp, sessionId],
  )
  return findSession(sessionId)
}

export async function markSessionClientHeartbeat(sessionId: string, timestamp: string) {
  await getRuntimeDatabaseClient().execute(
    `
      UPDATE business_session
      SET
        last_client_seen_at = ?,
        updated_at = ?
      WHERE id = ?
        AND deleted_at IS NULL
    `,
    [timestamp, timestamp, sessionId],
  )
  return findSession(sessionId)
}

export async function markSessionClientDisconnected(sessionId: string, timestamp: string) {
  await getRuntimeDatabaseClient().execute(
    `
      UPDATE business_session
      SET
        client_connected_count = CASE
          WHEN client_connected_count > 0 THEN client_connected_count - 1
          ELSE 0
        END,
        last_client_disconnected_at = CASE
          WHEN client_connected_count <= 1 THEN ?
          ELSE last_client_disconnected_at
        END,
        updated_at = ?
      WHERE id = ?
        AND deleted_at IS NULL
    `,
    [timestamp, timestamp, sessionId],
  )
  return findSession(sessionId)
}

export async function softDeleteSessionsByWorkspaceId(input: {
  workspaceId: string
  deletedBy: string
}) {
  const deletedAt = now()
  await getRuntimeDatabaseClient().execute(
    `
      UPDATE business_session
      SET
        deleted_at = ?,
        updated_at = ?,
        updated_by = ?
      WHERE workspace_binding_id = ?
        AND deleted_at IS NULL
    `,
    [
      deletedAt,
      deletedAt,
      input.deletedBy,
      input.workspaceId,
    ],
  )
}
