import { getRuntimeDatabaseClient } from "../db/runtime-db"
import type { SessionStatus } from "../types"
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
  const rows = await getRuntimeDatabaseClient().queryRows<SessionRow>(buildSessionListQuery().sql)
  return rows.map(toBusinessSession)
}

export async function listSessionsForUser(user: User) {
  const query = buildSessionListQuery({
    tenantId: user.tenantId,
    organizationId: user.organizationId,
  })
  const rows = await getRuntimeDatabaseClient().queryRows<SessionRow>(query.sql, query.params)
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

export async function listSessions(input: {
  tenantId?: string
  organizationId?: string
  projectId?: string
  workspaceId?: string
  workspaceIds?: string[]
  createdBy?: string
  workerId?: string
  workerIds?: string[]
  statuses?: SessionStatus[]
  limit?: number
} = {}) {
  const query = buildSessionListQuery(input)
  const rows = await getRuntimeDatabaseClient().queryRows<SessionRow>(query.sql, query.params)
  return rows.map(toBusinessSession)
}

export async function countSessions(input: {
  tenantId?: string
  organizationId?: string
  projectId?: string
  workspaceId?: string
  workspaceIds?: string[]
  createdBy?: string
  workerId?: string
  workerIds?: string[]
  statuses?: SessionStatus[]
}) {
  const query = buildSessionWhereClause(input)
  const row = await getRuntimeDatabaseClient().queryFirst<{ count: number }>(
    `
      SELECT COUNT(*) AS count
      FROM business_session
      ${query.whereSql}
    `,
    query.params,
  )
  return Number(row?.count || 0)
}

function buildSessionListQuery(input: {
  tenantId?: string
  organizationId?: string
  projectId?: string
  workspaceId?: string
  workspaceIds?: string[]
  createdBy?: string
  workerId?: string
  workerIds?: string[]
  statuses?: SessionStatus[]
  limit?: number
} = {}) {
  const query = buildSessionWhereClause(input)
  return {
    sql: `
      ${SESSION_SELECT}
      ${query.whereSql}
      ORDER BY updated_at DESC
      ${typeof input.limit === "number" && input.limit > 0 ? "LIMIT ?" : ""}
    `,
    params:
      typeof input.limit === "number" && input.limit > 0
        ? [...query.params, Math.floor(input.limit)]
        : query.params,
  }
}

function buildSessionWhereClause(input: {
  tenantId?: string
  organizationId?: string
  projectId?: string
  workspaceId?: string
  workspaceIds?: string[]
  createdBy?: string
  workerId?: string
  workerIds?: string[]
  statuses?: SessionStatus[]
}) {
  const clauses = ["deleted_at IS NULL"]
  const params: Array<string> = []
  if (
    (input.workspaceIds && input.workspaceIds.length === 0) ||
    (input.workerIds && input.workerIds.length === 0) ||
    (input.statuses && input.statuses.length === 0)
  ) {
    // 中文/English: explicit empty scopes must stay empty instead of falling
    // through to a tenant-wide session scan.
    clauses.push("1 = 0")
  }
  if (input.tenantId) {
    clauses.push("tenant_id = ?")
    params.push(input.tenantId)
  }
  if (input.organizationId) {
    clauses.push("organization_id = ?")
    params.push(input.organizationId)
  }
  if (input.projectId) {
    clauses.push("project_id = ?")
    params.push(input.projectId)
  }
  if (input.workspaceId) {
    clauses.push("workspace_binding_id = ?")
    params.push(input.workspaceId)
  }
  if (input.workspaceIds?.length) {
    clauses.push(`workspace_binding_id IN (${input.workspaceIds.map(() => "?").join(", ")})`)
    params.push(...input.workspaceIds)
  }
  if (input.createdBy) {
    clauses.push("created_by = ?")
    params.push(input.createdBy)
  }
  if (input.workerId) {
    clauses.push("worker_node_id = ?")
    params.push(input.workerId)
  }
  if (input.workerIds?.length) {
    clauses.push(`worker_node_id IN (${input.workerIds.map(() => "?").join(", ")})`)
    params.push(...input.workerIds)
  }
  if (input.statuses?.length) {
    clauses.push(`status IN (${input.statuses.map(() => "?").join(", ")})`)
    params.push(...input.statuses)
  }
  return {
    whereSql: `WHERE ${clauses.join("\n        AND ")}`,
    params,
  }
}
