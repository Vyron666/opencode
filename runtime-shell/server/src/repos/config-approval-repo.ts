import { getRuntimeDatabaseClient } from "../db/runtime-db"
import { nextId, now } from "../store/state-support"
import type { ConfigApprovalRequest, ConfigApprovalStatus, ConfigNamespace, ConfigScopeLevel } from "../types"

type ConfigApprovalRequestRow = {
  id: string
  tenant_id: string
  organization_id: string
  request_id: string | null
  namespace: ConfigNamespace
  config_key: string
  scope_level: ConfigScopeLevel
  scope_id: string
  status: ConfigApprovalStatus
  summary_json: string
  payload_json: string
  created_at: string
  created_by: string
  reviewed_at: string | null
  reviewed_by: string | null
  review_comment: string | null
}

function toConfigApprovalRequest(row: ConfigApprovalRequestRow): ConfigApprovalRequest {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    organizationId: row.organization_id,
    requestId: row.request_id || undefined,
    namespace: row.namespace,
    configKey: row.config_key,
    scopeLevel: row.scope_level,
    scopeId: row.scope_id,
    status: row.status,
    summaryJson: safeParseJson(row.summary_json),
    payloadJson: safeParseJson(row.payload_json),
    createdAt: row.created_at,
    createdBy: row.created_by,
    reviewedAt: row.reviewed_at || undefined,
    reviewedBy: row.reviewed_by || undefined,
    reviewComment: row.review_comment || undefined,
  }
}

export async function createConfigApprovalRequest(input: {
  tenantId: string
  organizationId: string
  requestId?: string
  namespace: ConfigNamespace
  configKey: string
  scopeLevel: ConfigScopeLevel
  scopeId: string
  summaryJson: Record<string, unknown>
  payloadJson: Record<string, unknown>
  createdBy: string
}) {
  const db = getRuntimeDatabaseClient()
  const createdAt = now()
  const approval: ConfigApprovalRequest = {
    id: nextId("apr"),
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    requestId: input.requestId,
    namespace: input.namespace,
    configKey: input.configKey,
    scopeLevel: input.scopeLevel,
    scopeId: input.scopeId,
    status: "pending",
    summaryJson: input.summaryJson,
    payloadJson: input.payloadJson,
    createdAt,
    createdBy: input.createdBy,
  }
  await db.execute(
    `
      INSERT INTO config_approval_request (
        id,
        tenant_id,
        organization_id,
        request_id,
        namespace,
        config_key,
        scope_level,
        scope_id,
        status,
        summary_json,
        payload_json,
        created_at,
        created_by,
        reviewed_at,
        reviewed_by,
        review_comment
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      approval.id,
      approval.tenantId,
      approval.organizationId,
      approval.requestId || null,
      approval.namespace,
      approval.configKey,
      approval.scopeLevel,
      approval.scopeId,
      approval.status,
      JSON.stringify(approval.summaryJson),
      JSON.stringify(approval.payloadJson),
      approval.createdAt,
      approval.createdBy,
      null,
      null,
      null,
    ],
  )
  return approval
}

export async function listConfigApprovalRequests(input: {
  tenantId: string
  organizationId: string
  status?: ConfigApprovalStatus
}) {
  const db = getRuntimeDatabaseClient()
  const rows = await db.queryRows<ConfigApprovalRequestRow>(
    `
      SELECT
        id,
        tenant_id,
        organization_id,
        request_id,
        namespace,
        config_key,
        scope_level,
        scope_id,
        status,
        summary_json,
        payload_json,
        created_at,
        created_by,
        reviewed_at,
        reviewed_by,
        review_comment
      FROM config_approval_request
      WHERE tenant_id = ?
        AND organization_id = ?
        AND (? IS NULL OR status = ?)
      ORDER BY created_at DESC
    `,
    [input.tenantId, input.organizationId, input.status || null, input.status || null],
  )
  return rows.map(toConfigApprovalRequest)
}

export async function findConfigApprovalRequest(id: string) {
  const db = getRuntimeDatabaseClient()
  const row = await db.queryFirst<ConfigApprovalRequestRow>(
    `
      SELECT
        id,
        tenant_id,
        organization_id,
        request_id,
        namespace,
        config_key,
        scope_level,
        scope_id,
        status,
        summary_json,
        payload_json,
        created_at,
        created_by,
        reviewed_at,
        reviewed_by,
        review_comment
      FROM config_approval_request
      WHERE id = ?
      LIMIT 1
    `,
    [id],
  )
  if (!row) return
  return toConfigApprovalRequest(row)
}

export async function reviewConfigApprovalRequest(input: {
  id: string
  status: Extract<ConfigApprovalStatus, "approved" | "rejected">
  reviewedBy: string
  reviewComment?: string
}) {
  const db = getRuntimeDatabaseClient()
  const current = await findConfigApprovalRequest(input.id)
  if (!current) return
  const reviewedAt = now()
  await db.execute(
    `
      UPDATE config_approval_request
      SET
        status = ?,
        reviewed_at = ?,
        reviewed_by = ?,
        review_comment = ?
      WHERE id = ?
    `,
    [input.status, reviewedAt, input.reviewedBy, input.reviewComment || null, input.id],
  )
  return {
    ...current,
    status: input.status,
    reviewedAt,
    reviewedBy: input.reviewedBy,
    reviewComment: input.reviewComment,
  } satisfies ConfigApprovalRequest
}

function safeParseJson(raw: string) {
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}
