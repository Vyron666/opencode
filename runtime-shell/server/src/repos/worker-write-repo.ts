import { getRuntimeDatabaseClient } from "../db/runtime-db"
import { now, nextId } from "../store/state-support"
import type { WorkerNode } from "../types"
import { findWorkerByCode, findWorkerById } from "./worker-query-repo"

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
