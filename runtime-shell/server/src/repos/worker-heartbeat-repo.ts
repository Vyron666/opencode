import { getRuntimeDatabaseClient } from "../db/runtime-db"
import { now, nextId } from "../store/state-support"
import type { WorkerHeartbeat, WorkerStatus } from "../types"

type WorkerHeartbeatRow = {
  id: string
  worker_node_id: string
  capacity_used: number
  status: WorkerStatus
  reported_at: string
  created_at: string
}

function toWorkerHeartbeat(row: WorkerHeartbeatRow): WorkerHeartbeat {
  return {
    id: row.id,
    workerId: row.worker_node_id,
    capacityUsed: row.capacity_used,
    status: row.status,
    reportedAt: row.reported_at,
    createdAt: row.created_at,
  }
}

export async function createWorkerHeartbeat(input: {
  workerId: string
  capacityUsed: number
  status: WorkerStatus
  reportedAt?: string
}) {
  const db = getRuntimeDatabaseClient()
  const timestamp = input.reportedAt ?? now()
  const heartbeat: WorkerHeartbeat = {
    id: nextId("hb"),
    workerId: input.workerId,
    capacityUsed: input.capacityUsed,
    status: input.status,
    reportedAt: timestamp,
    createdAt: timestamp,
  }
  await db.execute(
    `
      INSERT INTO worker_heartbeat (
        id,
        worker_node_id,
        capacity_used,
        status,
        reported_at,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      heartbeat.id,
      heartbeat.workerId,
      heartbeat.capacityUsed,
      heartbeat.status,
      heartbeat.reportedAt,
      heartbeat.createdAt,
    ],
  )
  return heartbeat
}

export async function listLatestHeartbeats(workerId: string, limit = 20) {
  const db = getRuntimeDatabaseClient()
  const rows = await db.queryRows<WorkerHeartbeatRow>(
    `
      SELECT
        id,
        worker_node_id,
        capacity_used,
        status,
        reported_at,
        created_at
      FROM worker_heartbeat
      WHERE worker_node_id = ?
      ORDER BY reported_at DESC
      LIMIT ?
    `,
    [workerId, limit],
  )
  return rows.map(toWorkerHeartbeat)
}

export async function hasWorkerHeartbeat(workerId: string) {
  const db = getRuntimeDatabaseClient()
  const row = await db.queryFirst<{ id: string }>(
    `
      SELECT id
      FROM worker_heartbeat
      WHERE worker_node_id = ?
      LIMIT 1
    `,
    [workerId],
  )
  return Boolean(row)
}
