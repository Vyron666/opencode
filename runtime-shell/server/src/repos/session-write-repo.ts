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
  const updates = [
    patch.workspaceId !== undefined ? ["workspace_binding_id = ?", session.workspaceId] : null,
    patch.workerId !== undefined ? ["worker_node_id = ?", session.workerId] : null,
    patch.title !== undefined ? ["title = ?", session.title] : null,
    patch.status !== undefined ? ["status = ?", session.status] : null,
    patch.workspacePath !== undefined ? ["workspace_path = ?", session.workspacePath] : null,
    patch.lastEventAt !== undefined ? ["last_event_at = ?", session.lastEventAt || null] : null,
    patch.binding !== undefined ? ["binding_json = ?", session.binding ? stringifySessionJson(session.binding) : null] : null,
    patch.capabilityState !== undefined
      ? ["capability_state_json = ?", stringifySessionJson(session.capabilityState)]
      : null,
    ["updated_at = ?", session.updatedAt],
    ["updated_by = ?", session.createdBy],
  ].filter((item): item is [string, string | null] => Boolean(item))
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
