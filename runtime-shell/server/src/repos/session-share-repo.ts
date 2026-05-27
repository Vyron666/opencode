import { getRuntimeDatabaseClient } from "../db/runtime-db"
import { nextId, now } from "../store/state-support"
import type { BusinessSession, SessionShareBinding } from "../types"

type SessionShareBindingRow = {
  id: string
  tenant_id: string
  organization_id: string
  project_id: string
  workspace_id: string
  business_session_id: string
  owner_user_id: string
  target_user_id: string
  status: "active" | "revoked"
  created_at: string
  created_by: string
  updated_at: string
  updated_by: string
}

function toSessionShareBinding(row: SessionShareBindingRow): SessionShareBinding {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    workspaceId: row.workspace_id,
    businessSessionId: row.business_session_id,
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
  const rows = await db.queryRows<SessionShareBindingRow>(
    `
      SELECT
        id,
        tenant_id,
        organization_id,
        project_id,
        workspace_id,
        business_session_id,
        owner_user_id,
        target_user_id,
        status,
        created_at,
        created_by,
        updated_at,
        updated_by
      FROM session_share_binding
      WHERE target_user_id = ?
        AND status = ?
        AND deleted_at IS NULL
      ORDER BY created_at DESC
    `,
    [userId, "active"],
  )
  return rows.map(toSessionShareBinding)
}

export async function findShareForSessionTarget(input: {
  businessSessionId: string
  targetUserId: string
}) {
  const db = getRuntimeDatabaseClient()
  const row = await db.queryFirst<SessionShareBindingRow>(
    `
      SELECT
        id,
        tenant_id,
        organization_id,
        project_id,
        workspace_id,
        business_session_id,
        owner_user_id,
        target_user_id,
        status,
        created_at,
        created_by,
        updated_at,
        updated_by
      FROM session_share_binding
      WHERE business_session_id = ?
        AND target_user_id = ?
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [input.businessSessionId, input.targetUserId],
  )
  if (!row) return
  return toSessionShareBinding(row)
}

export async function createShareBinding(input: {
  session: BusinessSession
  ownerUserId: string
  targetUserId: string
}) {
  const existing = await findShareForSessionTarget({
    businessSessionId: input.session.id,
    targetUserId: input.targetUserId,
  })
  if (existing?.status === "active") return existing

  const db = getRuntimeDatabaseClient()
  const timestamp = now()
  const binding: SessionShareBinding = {
    id: existing?.id || nextId("share"),
    tenantId: input.session.tenantId,
    organizationId: input.session.organizationId,
    projectId: input.session.projectId,
    workspaceId: input.session.workspaceId,
    businessSessionId: input.session.id,
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
        UPDATE session_share_binding
        SET
          status = ?,
          workspace_id = ?,
          updated_at = ?,
          updated_by = ?
        WHERE id = ?
          AND deleted_at IS NULL
      `,
      [binding.status, binding.workspaceId, binding.updatedAt, binding.updatedBy, binding.id],
    )
    return binding
  }

  await db.execute(
    `
      INSERT INTO session_share_binding (
        id,
        tenant_id,
        organization_id,
        project_id,
        workspace_id,
        business_session_id,
        owner_user_id,
        target_user_id,
        status,
        created_at,
        created_by,
        updated_at,
        updated_by,
        deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      binding.id,
      binding.tenantId,
      binding.organizationId,
      binding.projectId,
      binding.workspaceId,
      binding.businessSessionId,
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
  businessSessionId: string
  targetUserId: string
  updatedBy: string
}) {
  const existing = await findShareForSessionTarget(input)
  if (!existing) return false
  const db = getRuntimeDatabaseClient()
  await db.execute(
    `
      UPDATE session_share_binding
      SET status = ?, updated_at = ?, updated_by = ?
      WHERE id = ?
        AND deleted_at IS NULL
    `,
    ["revoked", now(), input.updatedBy, existing.id],
  )
  return true
}
