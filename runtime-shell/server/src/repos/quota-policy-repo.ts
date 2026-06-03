import { getRuntimeDatabaseClient } from "../db/runtime-db"
import type { QuotaPolicy, QuotaScopeType } from "../types"

type QuotaPolicyRow = {
  id: string
  tenant_id: string
  organization_id: string
  scope_type: QuotaScopeType
  scope_id: string
  enabled: boolean | number
  max_active_sessions: number | null
  max_queued_operations: number | null
  max_running_sandboxes: number | null
  max_warm_pool_per_worker: number | null
  created_at: string
  updated_at: string
  updated_by: string
}

const QUOTA_POLICY_SELECT = `
  SELECT
    id,
    tenant_id,
    organization_id,
    scope_type,
    scope_id,
    enabled,
    max_active_sessions,
    max_queued_operations,
    max_running_sandboxes,
    max_warm_pool_per_worker,
    created_at,
    updated_at,
    updated_by
  FROM quota_policy
`

export async function listQuotaPolicies(input?: {
  tenantId?: string
  organizationId?: string
}) {
  const clauses: string[] = []
  const params: string[] = []
  if (input?.tenantId) {
    clauses.push("tenant_id = ?")
    params.push(input.tenantId)
  }
  if (input?.organizationId) {
    clauses.push("organization_id = ?")
    params.push(input.organizationId)
  }
  const rows = await getRuntimeDatabaseClient().queryRows<QuotaPolicyRow>(
    `
      ${QUOTA_POLICY_SELECT}
      ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY updated_at DESC
    `,
    params,
  )
  return rows.map(toQuotaPolicy)
}

export async function findQuotaPolicy(input: {
  tenantId: string
  organizationId: string
  scopeType: QuotaScopeType
  scopeId: string
}) {
  const row = await getRuntimeDatabaseClient().queryFirst<QuotaPolicyRow>(
    `
      ${QUOTA_POLICY_SELECT}
      WHERE tenant_id = ?
        AND organization_id = ?
        AND scope_type = ?
        AND scope_id = ?
      LIMIT 1
    `,
    [input.tenantId, input.organizationId, input.scopeType, input.scopeId],
  )
  if (!row) return
  return toQuotaPolicy(row)
}

export async function upsertQuotaPolicy(input: QuotaPolicy) {
  const existing = await findQuotaPolicy({
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    scopeType: input.scopeType,
    scopeId: input.scopeId,
  })
  if (!existing) {
    await getRuntimeDatabaseClient().execute(
      `
        INSERT INTO quota_policy (
          id,
          tenant_id,
          organization_id,
          scope_type,
          scope_id,
          enabled,
          max_active_sessions,
          max_queued_operations,
          max_running_sandboxes,
          max_warm_pool_per_worker,
          created_at,
          updated_at,
          updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        input.id,
        input.tenantId,
        input.organizationId,
        input.scopeType,
        input.scopeId,
        input.enabled,
        input.maxActiveSessions ?? null,
        input.maxQueuedOperations ?? null,
        input.maxRunningSandboxes ?? null,
        input.maxWarmPoolPerWorker ?? null,
        input.createdAt,
        input.updatedAt,
        input.updatedBy,
      ],
    )
    return input
  }

  await getRuntimeDatabaseClient().execute(
    `
      UPDATE quota_policy
      SET
        enabled = ?,
        max_active_sessions = ?,
        max_queued_operations = ?,
        max_running_sandboxes = ?,
        max_warm_pool_per_worker = ?,
        updated_at = ?,
        updated_by = ?
      WHERE tenant_id = ?
        AND organization_id = ?
        AND scope_type = ?
        AND scope_id = ?
    `,
    [
      input.enabled,
      input.maxActiveSessions ?? null,
      input.maxQueuedOperations ?? null,
      input.maxRunningSandboxes ?? null,
      input.maxWarmPoolPerWorker ?? null,
      input.updatedAt,
      input.updatedBy,
      input.tenantId,
      input.organizationId,
      input.scopeType,
      input.scopeId,
    ],
  )
  return findQuotaPolicy({
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    scopeType: input.scopeType,
    scopeId: input.scopeId,
  })
}

function toQuotaPolicy(row: QuotaPolicyRow): QuotaPolicy {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    organizationId: row.organization_id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    enabled: Boolean(row.enabled),
    maxActiveSessions: row.max_active_sessions ?? undefined,
    maxQueuedOperations: row.max_queued_operations ?? undefined,
    maxRunningSandboxes: row.max_running_sandboxes ?? undefined,
    maxWarmPoolPerWorker: row.max_warm_pool_per_worker ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }
}
