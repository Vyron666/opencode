import { getRuntimeDatabaseClient } from "../db/runtime-db"
import type { RuntimeOperationQueueItem, RuntimeOperationStatus, RuntimeOperationType } from "../types"

type RuntimeOperationQueueRow = {
  id: string
  tenant_id: string
  organization_id: string
  project_id: string
  user_id: string
  business_session_id: string | null
  worker_node_id: string | null
  operation_type: RuntimeOperationType
  status: RuntimeOperationStatus
  idempotency_key: string | null
  detail_json: string
  error_message: string | null
  created_at: string
  updated_at: string
  started_at: string | null
  completed_at: string | null
}

const RUNTIME_OPERATION_SELECT = `
  SELECT
    id,
    tenant_id,
    organization_id,
    project_id,
    user_id,
    business_session_id,
    worker_node_id,
    operation_type,
    status,
    idempotency_key,
    detail_json,
    error_message,
    created_at,
    updated_at,
    started_at,
    completed_at
  FROM runtime_operation_queue
`

export async function createRuntimeOperation(input: RuntimeOperationQueueItem) {
  await getRuntimeDatabaseClient().execute(
    `
      INSERT INTO runtime_operation_queue (
        id,
        tenant_id,
        organization_id,
        project_id,
        user_id,
        business_session_id,
        worker_node_id,
        operation_type,
        status,
        idempotency_key,
        detail_json,
        error_message,
        created_at,
        updated_at,
        started_at,
        completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      input.id,
      input.tenantId,
      input.organizationId,
      input.projectId,
      input.userId,
      input.businessSessionId || null,
      input.workerId || null,
      input.operationType,
      input.status,
      input.idempotencyKey || null,
      JSON.stringify(input.detail ?? {}),
      input.errorMessage || null,
      input.createdAt,
      input.updatedAt,
      input.startedAt || null,
      input.completedAt || null,
    ],
  )
  return input
}

export async function updateRuntimeOperation(input: {
  id: string
  status: RuntimeOperationStatus
  updatedAt: string
  startedAt?: string
  completedAt?: string
  workerId?: string
  errorMessage?: string
}) {
  await getRuntimeDatabaseClient().execute(
    `
      UPDATE runtime_operation_queue
      SET
        status = ?,
        updated_at = ?,
        started_at = COALESCE(?, started_at),
        completed_at = ?,
        worker_node_id = COALESCE(?, worker_node_id),
        error_message = ?
      WHERE id = ?
    `,
    [
      input.status,
      input.updatedAt,
      input.startedAt || null,
      input.completedAt || null,
      input.workerId || null,
      input.errorMessage || null,
      input.id,
    ],
  )
}

export async function listRuntimeOperations(limit = 100) {
  const rows = await getRuntimeDatabaseClient().queryRows<RuntimeOperationQueueRow>(
    `
      ${RUNTIME_OPERATION_SELECT}
      ORDER BY created_at DESC
      LIMIT ?
    `,
    [limit],
  )
  return rows.map(toRuntimeOperation)
}

export async function countRuntimeOperationsByScope(input: {
  tenantId: string
  organizationId: string
  projectId?: string
  userId?: string
  workerId?: string
  statuses: RuntimeOperationStatus[]
}) {
  if (!input.statuses.length) return 0
  const clauses = ["tenant_id = ?", "organization_id = ?"]
  const params: Array<string> = [input.tenantId, input.organizationId]
  if (input.projectId) {
    clauses.push("project_id = ?")
    params.push(input.projectId)
  }
  if (input.userId) {
    clauses.push("user_id = ?")
    params.push(input.userId)
  }
  if (input.workerId) {
    clauses.push("worker_node_id = ?")
    params.push(input.workerId)
  }
  clauses.push(`status IN (${input.statuses.map(() => "?").join(", ")})`)
  params.push(...input.statuses)
  const row = await getRuntimeDatabaseClient().queryFirst<{ count: number }>(
    `
      SELECT COUNT(*) AS count
      FROM runtime_operation_queue
      WHERE ${clauses.join(" AND ")}
    `,
    params,
  )
  return Number(row?.count || 0)
}

function toRuntimeOperation(row: RuntimeOperationQueueRow): RuntimeOperationQueueItem {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    userId: row.user_id,
    businessSessionId: row.business_session_id || undefined,
    workerId: row.worker_node_id || undefined,
    operationType: row.operation_type,
    status: row.status,
    idempotencyKey: row.idempotency_key || undefined,
    detail: JSON.parse(row.detail_json) as Record<string, unknown>,
    errorMessage: row.error_message || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at || undefined,
    completedAt: row.completed_at || undefined,
  }
}
