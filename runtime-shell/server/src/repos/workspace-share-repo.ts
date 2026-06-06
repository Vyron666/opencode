import { getRuntimeDatabaseClient } from "../db/runtime-db"
import { nextId, now } from "../store/state-support"
import type { Workspace, WorkspaceShareBinding } from "../types"

type WorkspaceShareBindingRow = {
  id: string
  tenant_id: string
  organization_id: string
  project_id: string
  workspace_id: string
  owner_user_id: string
  target_user_id: string
  status: "active" | "revoked"
  created_at: string
  created_by: string
  updated_at: string
  updated_by: string
}

function toWorkspaceShareBinding(row: WorkspaceShareBindingRow): WorkspaceShareBinding {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    workspaceId: row.workspace_id,
    ownerUserId: row.owner_user_id,
    targetUserId: row.target_user_id,
    status: row.status,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }
}

export async function listSharesForTargetUser(userId: string) {
  const db = getRuntimeDatabaseClient()
  const rows = await db.queryRows<WorkspaceShareBindingRow>(
    `
      SELECT
        id,
        tenant_id,
        organization_id,
        project_id,
        workspace_id,
        owner_user_id,
        target_user_id,
        status,
        created_at,
        created_by,
        updated_at,
        updated_by
      FROM workspace_share_binding
      WHERE target_user_id = ?
        AND status = ?
        AND deleted_at IS NULL
      ORDER BY created_at DESC
    `,
    [userId, "active"],
  )
  const deduped = new Map<string, WorkspaceShareBinding>()
  rows.map(toWorkspaceShareBinding).forEach((binding) => {
    if (deduped.has(binding.workspaceId)) return
    deduped.set(binding.workspaceId, binding)
  })
  return [...deduped.values()]
}

export async function listSharesForWorkspace(workspaceId: string) {
  const db = getRuntimeDatabaseClient()
  const rows = await db.queryRows<WorkspaceShareBindingRow>(
    `
      SELECT
        id,
        tenant_id,
        organization_id,
        project_id,
        workspace_id,
        owner_user_id,
        target_user_id,
        status,
        created_at,
        created_by,
        updated_at,
        updated_by
      FROM workspace_share_binding
      WHERE workspace_id = ?
        AND status = ?
        AND deleted_at IS NULL
      ORDER BY created_at DESC
    `,
    [workspaceId, "active"],
  )
  const deduped = new Map<string, WorkspaceShareBinding>()
  rows.map(toWorkspaceShareBinding).forEach((binding) => {
    if (deduped.has(binding.targetUserId)) return
    deduped.set(binding.targetUserId, binding)
  })
  return [...deduped.values()]
}

export async function findShareForWorkspaceTarget(input: {
  workspaceId: string
  targetUserId: string
}) {
  const db = getRuntimeDatabaseClient()
  const row = await db.queryFirst<WorkspaceShareBindingRow>(
    `
      SELECT
        id,
        tenant_id,
        organization_id,
        project_id,
        workspace_id,
        owner_user_id,
        target_user_id,
        status,
        created_at,
        created_by,
        updated_at,
        updated_by
      FROM workspace_share_binding
      WHERE workspace_id = ?
        AND target_user_id = ?
        AND deleted_at IS NULL
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [input.workspaceId, input.targetUserId],
  )
  if (!row) return
  return toWorkspaceShareBinding(row)
}

export async function createShareBinding(input: {
  workspace: Workspace
  ownerUserId: string
  targetUserId: string
}) {
  const existing = await findShareForWorkspaceTarget({
    workspaceId: input.workspace.id,
    targetUserId: input.targetUserId,
  })
  if (existing?.status === "active") return existing

  const db = getRuntimeDatabaseClient()
  const timestamp = now()
  const binding: WorkspaceShareBinding = {
    id: existing?.id || nextId("wshare"),
    tenantId: input.workspace.tenantId,
    organizationId: input.workspace.organizationId,
    projectId: input.workspace.projectId,
    workspaceId: input.workspace.id,
    ownerUserId: input.ownerUserId,
    targetUserId: input.targetUserId,
    status: "active",
    createdAt: existing?.createdAt || timestamp,
    createdBy: existing?.createdBy || input.ownerUserId,
    updatedAt: timestamp,
    updatedBy: input.ownerUserId,
  }

  if (existing) {
    await db.execute(
      `
        UPDATE workspace_share_binding
        SET
          status = ?,
          project_id = ?,
          updated_at = ?,
          updated_by = ?
        WHERE id = ?
          AND deleted_at IS NULL
      `,
      [binding.status, binding.projectId, binding.updatedAt, binding.updatedBy, binding.id],
    )
    return binding
  }

  await db.execute(
    `
      INSERT INTO workspace_share_binding (
        id,
        tenant_id,
        organization_id,
        project_id,
        workspace_id,
        owner_user_id,
        target_user_id,
        status,
        created_at,
        created_by,
        updated_at,
        updated_by,
        deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      binding.id,
      binding.tenantId,
      binding.organizationId,
      binding.projectId,
      binding.workspaceId,
      binding.ownerUserId,
      binding.targetUserId,
      binding.status,
      binding.createdAt,
      binding.createdBy,
      binding.updatedAt,
      binding.updatedBy,
      null,
    ],
  )
  return binding
}

export async function revokeShareBinding(input: {
  workspaceId: string
  targetUserId: string
  updatedBy: string
}) {
  const existing = await findShareForWorkspaceTarget(input)
  if (!existing) return false
  const db = getRuntimeDatabaseClient()
  await db.execute(
    `
      UPDATE workspace_share_binding
      SET status = ?, updated_at = ?, updated_by = ?
      WHERE workspace_id = ?
        AND target_user_id = ?
        AND deleted_at IS NULL
    `,
    ["revoked", now(), input.updatedBy, input.workspaceId, input.targetUserId],
  )
  return true
}

export async function softDeleteSharesByWorkspaceId(input: {
  workspaceId: string
  deletedBy: string
}) {
  const timestamp = now()
  await getRuntimeDatabaseClient().execute(
    `
      UPDATE workspace_share_binding
      SET
        status = ?,
        updated_at = ?,
        updated_by = ?,
        deleted_at = ?
      WHERE workspace_id = ?
        AND deleted_at IS NULL
    `,
    ["revoked", timestamp, input.deletedBy, timestamp, input.workspaceId],
  )
}
