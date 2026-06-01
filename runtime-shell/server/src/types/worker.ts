export type WorkerStatus = "registering" | "ready" | "busy" | "degraded" | "offline" | "draining"

export type WorkerNode = {
  id: string
  tenantId?: string
  organizationId?: string
  workerCode: string
  name: string
  baseUrl: string
  status: WorkerStatus
  capacity: number
  activeSessionCount: number
  lastHeartbeatAt: string
  version?: string
}

export type WorkerHeartbeat = {
  id: string
  workerId: string
  capacityUsed: number
  status: WorkerStatus
  reportedAt: string
  createdAt: string
}
