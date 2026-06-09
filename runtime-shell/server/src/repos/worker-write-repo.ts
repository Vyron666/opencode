import { getRuntimeDatabaseClient } from "../db/runtime-db"
import { now, nextId } from "../store/state-support"
import type { WorkerNode } from "../types"
import { findWorkerByCode, findWorkerById } from "./worker-query-repo"

function stringifyWorkerResourceSummary(summary: WorkerNode["resourceSummary"]) {
  return summary ? JSON.stringify(summary) : null
}

export async function registerWorker(input: {
  workerId?: string
  tenantId?: string
  organizationId?: string
  workerCode: string
  name: string
  baseUrl: string
  capacity: number
  version?: string
  warmPoolTarget?: number
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
      warmPoolTarget: input.warmPoolTarget ?? existing.warmPoolTarget ?? 0,
    })
  }
  const timestamp = now()
  const worker: WorkerNode = {
    // 中文/English: local configured workers need stable ids so heartbeat, dashboard
    // filtering and scheduler reconciliation all point at the same DB row.
    id: input.workerId || nextId("worker"),
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
    warmPoolTarget: input.warmPoolTarget ?? 0,
    warmPoolReady: 0,
  }
  await getRuntimeDatabaseClient().execute(
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
        resource_summary_json,
        warm_pool_target,
        warm_pool_ready,
        created_at,
        created_by,
        updated_at,
        updated_by,
        deleted_at,
        version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      stringifyWorkerResourceSummary(worker.resourceSummary),
      worker.warmPoolTarget ?? 0,
      worker.warmPoolReady ?? 0,
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
  await getRuntimeDatabaseClient().execute(
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
        resource_summary_json = ?,
        warm_pool_target = ?,
        warm_pool_ready = ?,
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
      stringifyWorkerResourceSummary(updated.resourceSummary),
      updated.warmPoolTarget ?? 0,
      updated.warmPoolReady ?? 0,
      now(),
      "system_worker",
      updated.version ?? null,
      workerId,
    ],
  )
  return findWorkerById(workerId)
}

export async function markWorkerOfflineIfHeartbeatExpired(workerId: string, expireBefore: string) {
  await getRuntimeDatabaseClient().execute(
    `
      UPDATE worker_node
      SET
        status = 'offline',
        updated_at = ?,
        updated_by = ?
      WHERE id = ?
        AND last_heartbeat_at < ?
        AND status IN ('registering', 'ready', 'busy', 'degraded', 'offline', 'draining')
        AND deleted_at IS NULL
    `,
    [
      now(),
      "system_worker",
      workerId,
      expireBefore,
    ],
  )
  const updated = await findWorkerById(workerId)
  if (!updated) return false
  // 中文/English: governance must only treat the worker as offline when the
  // persisted heartbeat is still stale after the conditional update finishes.
  return updated.status === "offline" && new Date(updated.lastHeartbeatAt).getTime() < new Date(expireBefore).getTime()
}

export async function refreshWorkerLoad(workerId: string, activeSessionCount: number) {
  const timestamp = now()
  await getRuntimeDatabaseClient().execute(
    `
      UPDATE worker_node
      SET
        active_session_count = ?,
        status = CASE
          WHEN status = 'ready' AND ? >= capacity THEN 'busy'
          WHEN status = 'busy' AND ? < capacity THEN 'ready'
          ELSE status
        END,
        updated_at = ?,
        updated_by = ?
      WHERE id = ?
        AND deleted_at IS NULL
    `,
    [
      activeSessionCount,
      activeSessionCount,
      activeSessionCount,
      timestamp,
      "system_worker",
      workerId,
    ],
  )
  return findWorkerById(workerId)
}
