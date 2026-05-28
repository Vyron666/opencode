import { getRuntimeDatabaseClient } from "../db/runtime-db"
import { now, nextId } from "../store/state-support"
import type { BusinessSessionRuntimeBinding, SessionRuntimeBindingStatus } from "../types"

type SessionRuntimeBindingRow = {
  id: string
  business_session_id: string
  worker_node_id: string
  acp_session_id: string | null
  runtime_key: string | null
  binding_status: SessionRuntimeBindingStatus
  bound_at: string
  released_at: string | null
  created_at: string
  updated_at: string
}

function toRuntimeBinding(row: SessionRuntimeBindingRow): BusinessSessionRuntimeBinding {
  return {
    id: row.id,
    businessSessionId: row.business_session_id,
    workerId: row.worker_node_id,
    acpSessionId: row.acp_session_id || undefined,
    runtimeKey: row.runtime_key || undefined,
    bindingStatus: row.binding_status,
    boundAt: row.bound_at,
    releasedAt: row.released_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listBindingsForWorker(workerId: string) {
  const db = getRuntimeDatabaseClient()
  const rows = await db.queryRows<SessionRuntimeBindingRow>(
    `
      SELECT
        id,
        business_session_id,
        worker_node_id,
        acp_session_id,
        runtime_key,
        binding_status,
        bound_at,
        released_at,
        created_at,
        updated_at
      FROM business_session_runtime_binding
      WHERE worker_node_id = ?
      ORDER BY created_at DESC
    `,
    [workerId],
  )
  return rows.map(toRuntimeBinding)
}

export async function findActiveBindingBySessionId(sessionId: string) {
  const db = getRuntimeDatabaseClient()
  const row = await db.queryFirst<SessionRuntimeBindingRow>(
    `
      SELECT
        id,
        business_session_id,
        worker_node_id,
        acp_session_id,
        runtime_key,
        binding_status,
        bound_at,
        released_at,
        created_at,
        updated_at
      FROM business_session_runtime_binding
      WHERE business_session_id = ?
        AND binding_status IN ('binding', 'bound', 'lost', 'releasing')
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [sessionId],
  )
  if (!row) return
  return toRuntimeBinding(row)
}

export async function findLatestBindingBySessionId(sessionId: string) {
  const db = getRuntimeDatabaseClient()
  const row = await db.queryFirst<SessionRuntimeBindingRow>(
    `
      SELECT
        id,
        business_session_id,
        worker_node_id,
        acp_session_id,
        runtime_key,
        binding_status,
        bound_at,
        released_at,
        created_at,
        updated_at
      FROM business_session_runtime_binding
      WHERE business_session_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [sessionId],
  )
  if (!row) return
  return toRuntimeBinding(row)
}

export async function createBinding(input: {
  businessSessionId: string
  workerId: string
  acpSessionId?: string
  runtimeKey?: string
  bindingStatus: SessionRuntimeBindingStatus
}) {
  const db = getRuntimeDatabaseClient()
  const timestamp = now()
  const binding: BusinessSessionRuntimeBinding = {
    id: nextId("bind"),
    businessSessionId: input.businessSessionId,
    workerId: input.workerId,
    acpSessionId: input.acpSessionId,
    runtimeKey: input.runtimeKey,
    bindingStatus: input.bindingStatus,
    boundAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  await db.execute(
    `
      INSERT INTO business_session_runtime_binding (
        id,
        business_session_id,
        worker_node_id,
        acp_session_id,
        runtime_key,
        binding_status,
        bound_at,
        released_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      binding.id,
      binding.businessSessionId,
      binding.workerId,
      binding.acpSessionId ?? null,
      binding.runtimeKey ?? null,
      binding.bindingStatus,
      binding.boundAt,
      null,
      binding.createdAt,
      binding.updatedAt,
    ],
  )
  return binding
}

export async function updateBinding(bindingId: string, patch: {
  workerId?: string
  acpSessionId?: string | null
  runtimeKey?: string | null
  bindingStatus?: SessionRuntimeBindingStatus
  releasedAt?: string | null
}) {
  const db = getRuntimeDatabaseClient()
  const current = await db.queryFirst<SessionRuntimeBindingRow>(
    `
      SELECT
        id,
        business_session_id,
        worker_node_id,
        acp_session_id,
        runtime_key,
        binding_status,
        bound_at,
        released_at,
        created_at,
        updated_at
      FROM business_session_runtime_binding
      WHERE id = ?
      LIMIT 1
    `,
    [bindingId],
  )
  if (!current) return
  const updated = {
    ...toRuntimeBinding(current),
    workerId: patch.workerId ?? current.worker_node_id,
    acpSessionId: patch.acpSessionId === undefined ? current.acp_session_id || undefined : patch.acpSessionId || undefined,
    runtimeKey: patch.runtimeKey === undefined ? current.runtime_key || undefined : patch.runtimeKey || undefined,
    bindingStatus: patch.bindingStatus ?? current.binding_status,
    releasedAt: patch.releasedAt === undefined ? current.released_at || undefined : patch.releasedAt || undefined,
    updatedAt: now(),
  }
  await db.execute(
    `
      UPDATE business_session_runtime_binding
      SET
        worker_node_id = ?,
        acp_session_id = ?,
        runtime_key = ?,
        binding_status = ?,
        released_at = ?,
        updated_at = ?
      WHERE id = ?
    `,
    [
      updated.workerId,
      updated.acpSessionId ?? null,
      updated.runtimeKey ?? null,
      updated.bindingStatus,
      updated.releasedAt ?? null,
      updated.updatedAt,
      bindingId,
    ],
  )
  return updated
}
