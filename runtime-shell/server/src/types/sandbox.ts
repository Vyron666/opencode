export type SandboxWorkspaceStatus = "ready" | "closing" | "closed" | "failed"

export type SandboxDiffStatus = "created" | "pending_review" | "applied" | "rejected" | "expired" | "failed"

export type SandboxInstanceStatus = "preparing" | "ready" | "running" | "warm" | "leased" | "closing" | "closed" | "failed"

export type SandboxBackend = "local-process" | "docker" | "gvisor" | "kata"

export type RuntimeOperationType =
  | "session_warmup"
  | "session_open"
  | "session_load"
  | "session_resume"
  | "session_fork"
  | "session_prompt"
  | "session_diff_create"
  | "session_diff_apply"

export type RuntimeOperationStatus = "queued" | "running" | "completed" | "failed" | "rejected"

export type QuotaScopeType = "tenant" | "organization" | "project" | "user"

export type SandboxWorkspace = {
  id: string
  businessSessionId: string
  workspaceId: string
  workspacePath: string
  sandboxPath: string
  status: SandboxWorkspaceStatus
  createdAt: string
  updatedAt: string
  expiresAt?: string
  closedAt?: string
}

export type SandboxDiffSummary = {
  addedFiles: string[]
  modifiedFiles: string[]
  deletedFiles: string[]
}

export type SandboxDiffPolicyResult = {
  requiresReview: boolean
  reasons: string[]
}

export type SandboxDiff = {
  id: string
  tenantId: string
  organizationId: string
  projectId: string
  workspaceId: string
  businessSessionId: string
  sandboxWorkspaceId: string
  workspaceMode: "copy"
  status: SandboxDiffStatus
  summary: SandboxDiffSummary
  artifactUri?: string
  policyResult: SandboxDiffPolicyResult
  idempotencyKey?: string
  createdBy: string
  createdAt: string
  updatedAt: string
  appliedAt?: string
  rejectedAt?: string
  expiresAt?: string
}

export type SandboxInstance = {
  id: string
  tenantId: string
  organizationId: string
  projectId: string
  workspaceId: string
  businessSessionId: string
  workerId: string
  backend: SandboxBackend
  runtimeClass?: string
  isolationMode?: string
  status: SandboxInstanceStatus
  sandboxPath: string
  createdAt: string
  updatedAt: string
  openedAt?: string
  closedAt?: string
  detail?: Record<string, unknown>
}

export type RuntimeOperationQueueItem = {
  id: string
  tenantId: string
  organizationId: string
  projectId: string
  userId: string
  businessSessionId?: string
  workerId?: string
  operationType: RuntimeOperationType
  status: RuntimeOperationStatus
  idempotencyKey?: string
  detail?: Record<string, unknown>
  errorMessage?: string
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
}

export type RuntimeOperationStage =
  | "queued"
  | "workspace_prepare"
  | "worker_assign"
  | "runtime_prewarm"
  | "runtime_open"
  | "completed"

export type QuotaPolicy = {
  id: string
  tenantId: string
  organizationId: string
  scopeType: QuotaScopeType
  scopeId: string
  enabled: boolean
  maxActiveSessions?: number
  maxQueuedOperations?: number
  maxRunningSandboxes?: number
  maxWarmPoolPerWorker?: number
  createdAt: string
  updatedAt: string
  updatedBy: string
}
