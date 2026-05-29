import { getRuntimeDatabaseClient } from "../db/runtime-db"
import { now, nextId } from "../store/state-support"
import type { User, WorkerNode, WorkerStatus } from "../types"

type WorkerRow = {
  id: string
  tenant_id: string | null
  organization_id: string | null
  worker_code: string
  name: string
  base_url: string
  status: WorkerStatus
  capacity: number
  active_session_count: number
  last_heartbeat_at: string
  updated_at: string
  version: string | null
}

function toWorker(row: WorkerRow): WorkerNode {
  return {
    id: row.id,
    tenantId: row.tenant_id || undefined,
    organizationId: row.organization_id || undefined,
    workerCode: row.worker_code,
    name: row.name,
    baseUrl: row.base_url,
    status: row.status,
    capacity: row.capacity,
    activeSessionCount: row.active_session_count,
    lastHeartbeatAt: row.last_heartbeat_at,
    version: row.version || undefined,
  }
}

export async function listAllWorkers() {
  const db = getRuntimeDatabaseClient()
  const rows = await db.queryRows<WorkerRow>(
    `
      SELECT
        id,
        tenant_id,
        organization_id,
        worker_code,
        name,
        base_url,
        status,
        capacity,
        active_session_count,
        last_heartbeat_at,
        updated_at,
        version
      FROM worker_node
      WHERE deleted_at IS NULL
      ORDER BY created_at ASC
    `,
  )
  return rows.map(toWorker)
}

export async function findWorkerById(workerId: string) {
  const db = getRuntimeDatabaseClient()
  const row = await db.queryFirst<WorkerRow>(
    `
      SELECT
        id,
        tenant_id,
        organization_id,
        worker_code,
        name,
        base_url,
        status,
        capacity,
        active_session_count,
        last_heartbeat_at,
        updated_at,
        version
      FROM worker_node
      WHERE id = ?
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [workerId],
  )
  if (!row) return
  return toWorker(row)
}

export async function findWorkerByCode(workerCode: string) {
  const db = getRuntimeDatabaseClient()
  const row = await db.queryFirst<WorkerRow>(
    `
      SELECT
        id,
        tenant_id,
        organization_id,
        worker_code,
        name,
        base_url,
        status,
        capacity,
        active_session_count,
        last_heartbeat_at,
        updated_at,
        version
      FROM worker_node
      WHERE worker_code = ?
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [workerCode],
  )
  if (!row) return
  return toWorker(row)
}

export async function listReadyWorkersForUser(user: User) {
  const db = getRuntimeDatabaseClient()
  const rows = await db.queryRows<WorkerRow>(
    `
      SELECT
        id,
        tenant_id,
        organization_id,
        worker_code,
        name,
        base_url,
        status,
        capacity,
        active_session_count,
        last_heartbeat_at,
        updated_at,
        version
      FROM worker_node
      WHERE status IN ('ready', 'busy', 'degraded')
        AND deleted_at IS NULL
        AND (tenant_id IS NULL OR tenant_id = ?)
        AND (organization_id IS NULL OR organization_id = ?)
      ORDER BY active_session_count ASC, updated_at ASC
    `,
    [user.tenantId, user.organizationId],
  )
  return rows.map(toWorker)
}

export async function listWorkersByStatus(statuses: WorkerStatus[]) {
  if (!statuses.length) return []
  const db = getRuntimeDatabaseClient()
  const placeholders = statuses.map(() => "?").join(", ")
  const rows = await db.queryRows<WorkerRow>(
    `
      SELECT
        id,
        tenant_id,
        organization_id,
        worker_code,
        name,
        base_url,
        status,
        capacity,
        active_session_count,
        last_heartbeat_at,
        updated_at,
        version
      FROM worker_node
      WHERE status IN (${placeholders})
        AND deleted_at IS NULL
      ORDER BY updated_at DESC
    `,
    statuses,
  )
  return rows.map(toWorker)
}

export async function registerWorker(input: {
  tenantId?: string
  organizationId?: string
  workerCode: string
  name: string
  baseUrl: string
  capacity: number
  version?: string
}) {
  const existing = await findWorkerByCode(input.workerCode)
  if (existing) {
    return updateWorker(existing.id, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      name: input.name,
      baseUrl: input.baseUrl,
      capacity: input.capacity,
      status: "ready",
      version: input.version,
    })
  }
  const db = getRuntimeDatabaseClient()
  const timestamp = now()
  const worker: WorkerNode = {
    id: nextId("worker"),
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    workerCode: input.workerCode,
    name: input.name,
    baseUrl: input.baseUrl,
    status: "ready",
    capacity: input.capacity,
    activeSessionCount: 0,
    lastHeartbeatAt: timestamp,
    version: input.version,
  }
  await db.execute(
    `
      INSERT INTO worker_node (
        id,
        tenant_id,
        organization_id,
        worker_code,
        name,
        base_url,
        status,
        capacity,
        active_session_count,
        last_heartbeat_at,
        created_at,
        created_by,
        updated_at,
        updated_by,
        deleted_at,
        version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      worker.id,
      worker.tenantId ?? null,
      worker.organizationId ?? null,
      worker.workerCode,
      worker.name,
      worker.baseUrl,
      worker.status,
      worker.capacity,
      worker.activeSessionCount,
      worker.lastHeartbeatAt,
      timestamp,
      "system_worker",
      timestamp,
      "system_worker",
      null,
      worker.version ?? null,
    ],
  )
  return worker
}

export async function updateWorker(workerId: string, patch: Partial<WorkerNode>) {
  const current = await findWorkerById(workerId)
  if (!current) return
  const updated = {
    ...current,
    ...patch,
    lastHeartbeatAt: patch.lastHeartbeatAt ?? current.lastHeartbeatAt,
  }
  const db = getRuntimeDatabaseClient()
  await db.execute(
    `
      UPDATE worker_node
      SET
        tenant_id = ?,
        organization_id = ?,
        name = ?,
        base_url = ?,
        status = ?,
        capacity = ?,
        active_session_count = ?,
        last_heartbeat_at = ?,
        updated_at = ?,
        updated_by = ?,
        version = ?
      WHERE id = ?
        AND deleted_at IS NULL
    `,
    [
      updated.tenantId ?? null,
      updated.organizationId ?? null,
      updated.name,
      updated.baseUrl,
      updated.status,
      updated.capacity,
      updated.activeSessionCount,
      updated.lastHeartbeatAt,
      now(),
      "system_worker",
      updated.version ?? null,
      workerId,
    ],
  )
  return findWorkerById(workerId)
}

export async function listWorkersHeartbeatExpired(expireBefore: string) {
  const db = getRuntimeDatabaseClient()
  const rows = await db.queryRows<WorkerRow>(
    `
      SELECT
        id,
        tenant_id,
        organization_id,
        worker_code,
        name,
        base_url,
        status,
        capacity,
        active_session_count,
        last_heartbeat_at,
        updated_at,
        version
      FROM worker_node
      WHERE last_heartbeat_at < ?
        AND status IN ('registering', 'ready', 'busy', 'degraded', 'offline', 'draining')
        AND deleted_at IS NULL
      ORDER BY last_heartbeat_at ASC
    `,
    [expireBefore],
  )
  return rows.map(toWorker)
}
