export type SandboxWorkspaceStatus = "ready" | "closing" | "closed" | "failed"

export type SandboxDiffStatus = "created" | "pending_review" | "applied" | "rejected" | "expired" | "failed"

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
