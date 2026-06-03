import { getRuntimeDatabaseClient } from "../db/runtime-db"
import type { SandboxWorkspace, SandboxWorkspaceStatus } from "../types"

type SandboxWorkspaceRow = {
  id: string
  business_session_id: string
  workspace_id: string
  workspace_path: string
  sandbox_path: string
  status: SandboxWorkspaceStatus
  created_at: string
  updated_at: string
  expires_at: string | null
  closed_at: string | null
}

export async function findSandboxWorkspaceByWorkspaceId(workspaceId: string) {
  const row = await getRuntimeDatabaseClient().queryFirst<SandboxWorkspaceRow>(
    `
      SELECT
        id,
        business_session_id,
        workspace_id,
        workspace_path,
        sandbox_path,
        status,
        created_at,
        updated_at,
        expires_at,
        closed_at
      FROM sandbox_workspace
      WHERE workspace_id = ?
      LIMIT 1
    `,
    [workspaceId],
  )
  if (!row) return
  return toSandboxWorkspace(row)
}

export async function upsertSandboxWorkspace(input: SandboxWorkspace) {
  const existing = await findSandboxWorkspaceByWorkspaceId(input.workspaceId)
  if (!existing) {
    await getRuntimeDatabaseClient().execute(
      `
        INSERT INTO sandbox_workspace (
          id,
          business_session_id,
          workspace_id,
          workspace_path,
          sandbox_path,
          status,
          created_at,
          updated_at,
          expires_at,
          closed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        input.id,
        input.businessSessionId,
        input.workspaceId,
        input.workspacePath,
        input.sandboxPath,
        input.status,
        input.createdAt,
        input.updatedAt,
        input.expiresAt || null,
        input.closedAt || null,
      ],
    )
    return
  }

  await getRuntimeDatabaseClient().execute(
    `
      UPDATE sandbox_workspace
      SET
        business_session_id = ?,
        workspace_id = ?,
        workspace_path = ?,
        sandbox_path = ?,
        status = ?,
        updated_at = ?,
        expires_at = ?,
        closed_at = ?
      WHERE workspace_id = ?
    `,
    [
      input.businessSessionId,
      input.workspaceId,
      input.workspacePath,
      input.sandboxPath,
      input.status,
      input.updatedAt,
      input.expiresAt || null,
      input.closedAt || null,
      input.workspaceId,
    ],
  )
}

export async function listSandboxWorkspacesForCleanup(input: {
  limit: number
  includeUnexpiredClosed?: boolean
}) {
  const rows = await getRuntimeDatabaseClient().queryRows<SandboxWorkspaceRow>(
    `
      SELECT
        id,
        business_session_id,
        workspace_id,
        workspace_path,
        sandbox_path,
        status,
        created_at,
        updated_at,
        expires_at,
        closed_at
      FROM sandbox_workspace
      WHERE status = 'closed'
        AND (
          ? = 1
          OR (expires_at IS NOT NULL AND expires_at <= ?)
        )
      ORDER BY updated_at ASC
      LIMIT ?
    `,
    [
      input.includeUnexpiredClosed ? 1 : 0,
      new Date().toISOString(),
      input.limit,
    ],
  )
  return rows.map(toSandboxWorkspace)
}

export async function deleteSandboxWorkspaceByWorkspaceId(workspaceId: string) {
  await getRuntimeDatabaseClient().execute(
    `
      DELETE FROM sandbox_workspace
      WHERE workspace_id = ?
    `,
    [workspaceId],
  )
}

function toSandboxWorkspace(row: SandboxWorkspaceRow): SandboxWorkspace {
  return {
    id: row.id,
    businessSessionId: row.business_session_id,
    workspaceId: row.workspace_id,
    workspacePath: row.workspace_path,
    sandboxPath: row.sandbox_path,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at || undefined,
    closedAt: row.closed_at || undefined,
  }
}
