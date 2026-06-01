import { getRuntimeDatabaseClient } from "../db/runtime-db"
import type { User } from "../types"
import { toBusinessSession, type SessionRow } from "./session-row-mappers"

const SESSION_SELECT = `
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
`

export async function listAllSessions() {
  const rows = await getRuntimeDatabaseClient().queryRows<SessionRow>(
    `
      ${SESSION_SELECT}
      WHERE deleted_at IS NULL
      ORDER BY updated_at DESC
    `,
  )
  return rows.map(toBusinessSession)
}

export async function listSessionsForUser(user: User) {
  const rows = await getRuntimeDatabaseClient().queryRows<SessionRow>(
    `
      ${SESSION_SELECT}
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
  const row = await getRuntimeDatabaseClient().queryFirst<SessionRow>(
    `
      ${SESSION_SELECT}
      WHERE id = ?
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [sessionId],
  )
  if (!row) return
  return toBusinessSession(row)
}
