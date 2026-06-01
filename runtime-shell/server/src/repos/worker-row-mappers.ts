import type { WorkerNode, WorkerStatus } from "../types"

export type WorkerRow = {
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

export function toWorker(row: WorkerRow): WorkerNode {
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
