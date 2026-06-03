import { getRuntimeDatabaseClient } from "../db/runtime-db"
import { now, nextId } from "../store/state-support"
import type { AuditAction, AuditLog, AuditResourceType } from "../types"

type AuditLogRow = {
  id: string
  tenant_id: string
  organization_id: string
  project_id: string | null
  user_id: string | null
  business_session_id: string | null
  request_id: string | null
  action: AuditAction
  resource_type: AuditResourceType
  resource_id: string | null
  detail_json: string
  created_at: string
}

export async function listAuditLogs(limit = 200) {
  const rows = await getRuntimeDatabaseClient().queryRows<AuditLogRow>(
    `
      SELECT
        id,
        tenant_id,
        organization_id,
        project_id,
        user_id,
        business_session_id,
        request_id,
        action,
        resource_type,
        resource_id,
        detail_json,
        created_at
      FROM audit_log
      ORDER BY created_at DESC
      LIMIT ?
    `,
    [limit],
  )
  return rows.map(toAuditLog)
}

export async function appendAuditLog(input: {
  tenantId: string
  organizationId: string
  projectId?: string
  userId?: string
  businessSessionId?: string
  requestId?: string
  action: AuditAction
  resourceType: AuditResourceType
  resourceId?: string
  detail: Record<string, unknown>
}) {
  const createdAt = now()
  const auditLog: AuditLog = {
    id: nextId("audit"),
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    projectId: input.projectId,
    userId: input.userId,
    businessSessionId: input.businessSessionId,
    requestId: input.requestId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    detail: input.detail,
    createdAt,
  }
  await getRuntimeDatabaseClient().execute(
    `
      INSERT INTO audit_log (
        id,
        tenant_id,
        organization_id,
        project_id,
        user_id,
        business_session_id,
        request_id,
        action,
        resource_type,
        resource_id,
        detail_json,
        created_at,
        created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      auditLog.id,
      auditLog.tenantId,
      auditLog.organizationId,
      auditLog.projectId || null,
      auditLog.userId || null,
      auditLog.businessSessionId || null,
      auditLog.requestId || null,
      auditLog.action,
      auditLog.resourceType,
      auditLog.resourceId || null,
      JSON.stringify(auditLog.detail),
      auditLog.createdAt,
      auditLog.userId || "system",
    ],
  )
  return auditLog
}

function toAuditLog(row: AuditLogRow): AuditLog {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    organizationId: row.organization_id,
    projectId: row.project_id || undefined,
    userId: row.user_id || undefined,
    businessSessionId: row.business_session_id || undefined,
    requestId: row.request_id || undefined,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id || undefined,
    detail: JSON.parse(row.detail_json) as Record<string, unknown>,
    createdAt: row.created_at,
  }
}
