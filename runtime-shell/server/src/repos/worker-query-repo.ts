import { getRuntimeDatabaseClient } from "../db/runtime-db"
import type { User, WorkerStatus } from "../types"
import { toWorker, type WorkerRow } from "./worker-row-mappers"

const WORKER_SELECT = `
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
`

export async function listAllWorkers() {
  const rows = await getRuntimeDatabaseClient().queryRows<WorkerRow>(
    `
      ${WORKER_SELECT}
      WHERE deleted_at IS NULL
      ORDER BY created_at ASC
    `,
  )
  return rows.map(toWorker)
}

export async function findWorkerById(workerId: string) {
  const row = await getRuntimeDatabaseClient().queryFirst<WorkerRow>(
    `
      ${WORKER_SELECT}
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
  const row = await getRuntimeDatabaseClient().queryFirst<WorkerRow>(
    `
      ${WORKER_SELECT}
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
  const rows = await getRuntimeDatabaseClient().queryRows<WorkerRow>(
    `
      ${WORKER_SELECT}
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
  const placeholders = statuses.map(() => "?").join(", ")
  const rows = await getRuntimeDatabaseClient().queryRows<WorkerRow>(
    `
      ${WORKER_SELECT}
      WHERE status IN (${placeholders})
        AND deleted_at IS NULL
      ORDER BY updated_at DESC
    `,
    statuses,
  )
  return rows.map(toWorker)
}

export async function listWorkersHeartbeatExpired(expireBefore: string) {
  const rows = await getRuntimeDatabaseClient().queryRows<WorkerRow>(
    `
      ${WORKER_SELECT}
      WHERE last_heartbeat_at < ?
        AND status IN ('registering', 'ready', 'busy', 'degraded', 'offline', 'draining')
        AND deleted_at IS NULL
      ORDER BY last_heartbeat_at ASC
    `,
    [expireBefore],
  )
  return rows.map(toWorker)
}
