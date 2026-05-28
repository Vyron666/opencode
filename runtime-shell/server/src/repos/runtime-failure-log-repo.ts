import { getRuntimeDatabaseClient } from "../db/runtime-db"
import { now, nextId } from "../store/state-support"
import type { RuntimeFailureLog, RuntimeFailureType } from "../types"

type RuntimeFailureLogRow = {
  id: string
  business_session_id: string | null
  worker_node_id: string | null
  failure_type: RuntimeFailureType
  message: string | null
  detail_json: string | null
  created_at: string
}

function parseJson(value: string | null) {
  if (!value) return undefined
  return JSON.parse(value) as Record<string, unknown>
}

function toRuntimeFailureLog(row: RuntimeFailureLogRow): RuntimeFailureLog {
  return {
    id: row.id,
    businessSessionId: row.business_session_id || undefined,
    workerId: row.worker_node_id || undefined,
    failureType: row.failure_type,
    message: row.message || undefined,
    detail: parseJson(row.detail_json),
    createdAt: row.created_at,
  }
}

export async function createRuntimeFailureLog(input: {
  businessSessionId?: string
  workerId?: string
  failureType: RuntimeFailureType
  message?: string
  detail?: Record<string, unknown>
}) {
  const db = getRuntimeDatabaseClient()
  const failure: RuntimeFailureLog = {
    id: nextId("rfl"),
    businessSessionId: input.businessSessionId,
    workerId: input.workerId,
    failureType: input.failureType,
    message: input.message,
    detail: input.detail,
    createdAt: now(),
  }
  await db.execute(
    `
      INSERT INTO runtime_failure_log (
        id,
        business_session_id,
        worker_node_id,
        failure_type,
        message,
        detail_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      failure.id,
      failure.businessSessionId ?? null,
      failure.workerId ?? null,
      failure.failureType,
      failure.message ?? null,
      failure.detail ? JSON.stringify(failure.detail) : null,
      failure.createdAt,
    ],
  )
  return failure
}

export async function listRecentRuntimeFailuresBySession(sessionId: string, limit = 20) {
  const db = getRuntimeDatabaseClient()
  const rows = await db.queryRows<RuntimeFailureLogRow>(
    `
      SELECT
        id,
        business_session_id,
        worker_node_id,
        failure_type,
        message,
        detail_json,
        created_at
      FROM runtime_failure_log
      WHERE business_session_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `,
    [sessionId, limit],
  )
  return rows.map(toRuntimeFailureLog)
}

export async function listRecentRuntimeFailures(limit = 20) {
  const db = getRuntimeDatabaseClient()
  const rows = await db.queryRows<RuntimeFailureLogRow>(
    `
      SELECT
        id,
        business_session_id,
        worker_node_id,
        failure_type,
        message,
        detail_json,
        created_at
      FROM runtime_failure_log
      ORDER BY created_at DESC
      LIMIT ?
    `,
    [limit],
  )
  return rows.map(toRuntimeFailureLog)
}
