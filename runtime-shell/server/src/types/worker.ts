export type WorkerStatus = "registering" | "ready" | "busy" | "degraded" | "offline" | "draining"

export type WorkerResourceSummary = {
  runningSandboxCount: number
  warmSandboxCount: number
  queuedOperationCount: number
  cpuPercent?: number
  memoryBytes?: number
  diskBytes?: number
}

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
  resourceSummary?: WorkerResourceSummary
  warmPoolTarget?: number
  warmPoolReady?: number
}

export type WorkerHeartbeat = {
  id: string
  workerId: string
  capacityUsed: number
  status: WorkerStatus
  reportedAt: string
  createdAt: string
  resourceSummary?: WorkerResourceSummary
}
