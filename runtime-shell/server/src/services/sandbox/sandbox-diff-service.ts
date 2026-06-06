import {
  createSandboxDiff,
  findLatestSandboxDiffBySessionId,
  findSandboxDiffById,
  updateSandboxDiffStatus,
} from "../../repos/sandbox-diff-repo"
import type { BusinessSession, SandboxDiff, User } from "../../types"
import { auditService } from "../store/store-singleton"
import { evaluateSandboxDiffPolicy } from "./sandbox-policy-service"
import { getSandboxWorkspace } from "./sandbox-workspace-service"
import {
  applyWorkspaceSyncSummary,
  buildWorkspaceSyncSummary,
} from "./sandbox-workspace-sync"

export async function createSessionDiff(input: {
  session: BusinessSession
  user: User
}) {
  const sandboxWorkspace = await getSandboxWorkspace(input.session.workspaceId)
  if (!sandboxWorkspace || sandboxWorkspace.status !== "ready") return
  const summary = await buildWorkspaceSyncSummary(input.session.workspacePath, sandboxWorkspace.sandboxPath)
  const policyResult = evaluateSandboxDiffPolicy(summary)
  const now = new Date().toISOString()
  const diff: SandboxDiff = {
    id: `sbd_${crypto.randomUUID().replace(/-/g, "")}`,
    tenantId: input.session.tenantId,
    organizationId: input.session.organizationId,
    projectId: input.session.projectId,
    workspaceId: input.session.workspaceId,
    businessSessionId: input.session.id,
    sandboxWorkspaceId: sandboxWorkspace.id,
    workspaceMode: "copy",
    status: policyResult.requiresReview ? "pending_review" : "created",
    summary,
    policyResult,
    createdBy: input.user.id,
    createdAt: now,
    updatedAt: now,
    expiresAt: sandboxWorkspace.expiresAt,
  }
  await createSandboxDiff(diff)
  void auditService.appendAuditLog({
    tenantId: input.session.tenantId,
    organizationId: input.session.organizationId,
    projectId: input.session.projectId,
    userId: input.user.id,
    businessSessionId: input.session.id,
    action: "file.diff.generated",
    resourceType: "sandbox_diff",
    resourceId: diff.id,
    detail: {
      summary,
      policyResult,
    },
  })
  if (policyResult.requiresReview) {
    void auditService.appendAuditLog({
      tenantId: input.session.tenantId,
      organizationId: input.session.organizationId,
      projectId: input.session.projectId,
      userId: input.user.id,
      businessSessionId: input.session.id,
      action: "policy.denied",
      resourceType: "policy",
      resourceId: diff.id,
      detail: {
        policy: "sandbox_diff_review",
        reasons: policyResult.reasons,
      },
    })
  }
  return diff
}

export async function getLatestSessionDiff(sessionId: string) {
  return findLatestSandboxDiffBySessionId(sessionId)
}

export async function rejectSessionDiff(input: {
  diffId: string
}) {
  const diff = await findSandboxDiffById(input.diffId)
  if (!diff) return
  if (diff.status === "applied") {
    throw new Error(`sandbox diff already applied: ${diff.id}`)
  }
  const now = new Date().toISOString()
  await updateSandboxDiffStatus({
    diffId: diff.id,
    status: "rejected",
    updatedAt: now,
    rejectedAt: now,
  })
  void auditService.appendAuditLog({
    tenantId: diff.tenantId,
    organizationId: diff.organizationId,
    projectId: diff.projectId,
    businessSessionId: diff.businessSessionId,
    action: "file.diff.rejected",
    resourceType: "sandbox_diff",
    resourceId: diff.id,
    detail: {
      reasons: diff.policyResult.reasons,
    },
  })
  return findSandboxDiffById(diff.id)
}

export async function applySessionDiff(input: {
  session: BusinessSession
  diffId: string
  idempotencyKey: string
}) {
  const diff = await findSandboxDiffById(input.diffId)
  if (!diff) return
  if (diff.businessSessionId !== input.session.id) {
    throw new Error(`sandbox diff does not belong to session: ${diff.id}`)
  }
  if (diff.status === "applied" && diff.idempotencyKey === input.idempotencyKey) return diff
  if (diff.status === "applied") {
    throw new Error(`sandbox diff already applied with different idempotency key: ${diff.id}`)
  }
  if (diff.status === "rejected" || diff.status === "expired" || diff.status === "failed") {
    throw new Error(`sandbox diff is not applicable: ${diff.id}`)
  }
  if (diff.status === "pending_review" || diff.policyResult.requiresReview) {
    throw new Error(`sandbox diff requires review before apply: ${diff.id}`)
  }
  const sandboxWorkspace = await getSandboxWorkspace(input.session.workspaceId)
  if (!sandboxWorkspace || sandboxWorkspace.status !== "ready") return
  await applyWorkspaceSyncSummary(input.session.workspacePath, sandboxWorkspace.sandboxPath, diff.summary)
  const now = new Date().toISOString()
  await updateSandboxDiffStatus({
    diffId: diff.id,
    status: "applied",
    updatedAt: now,
    appliedAt: now,
    idempotencyKey: input.idempotencyKey,
  })
  void auditService.appendAuditLog({
    tenantId: diff.tenantId,
    organizationId: diff.organizationId,
    projectId: diff.projectId,
    businessSessionId: diff.businessSessionId,
    action: "file.diff.applied",
    resourceType: "sandbox_diff",
    resourceId: diff.id,
    detail: {
      idempotencyKey: input.idempotencyKey,
      summary: diff.summary,
    },
  })
  return findSandboxDiffById(diff.id)
}
