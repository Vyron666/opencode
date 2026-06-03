import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { Config } from "../../config"
import {
  createSandboxDiff,
  findLatestSandboxDiffBySessionId,
  findSandboxDiffById,
  updateSandboxDiffStatus,
} from "../../repos/sandbox-diff-repo"
import type { BusinessSession, SandboxDiff, SandboxDiffSummary, User } from "../../types"
import { auditService } from "../store/store-singleton"
import { evaluateSandboxDiffPolicy } from "./sandbox-policy-service"
import { getSandboxWorkspace } from "./sandbox-workspace-service"

export async function createSessionDiff(input: {
  session: BusinessSession
  user: User
}) {
  const sandboxWorkspace = await getSandboxWorkspace(input.session.workspaceId)
  if (!sandboxWorkspace || sandboxWorkspace.status !== "ready") return
  const summary = await buildDiffSummary(input.session.workspacePath, sandboxWorkspace.sandboxPath)
  const policyResult = evaluateSandboxDiffPolicy(summary)
  const artifactDir = path.join(Config.storageDir, "sandbox-diff")
  await mkdir(artifactDir, { recursive: true })
  const artifactPath = path.join(artifactDir, `${input.session.id}.json`)
  await writeFile(artifactPath, JSON.stringify(summary, null, 2), "utf8")
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
    artifactUri: artifactPath,
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
  await applyDiffSummary(input.session.workspacePath, sandboxWorkspace.sandboxPath, diff.summary)
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

async function buildDiffSummary(realPath: string, sandboxPath: string): Promise<SandboxDiffSummary> {
  const realFiles = await listRelativeFiles(realPath)
  const sandboxFiles = await listRelativeFiles(sandboxPath)
  const realSet = new Set(realFiles)
  const sandboxSet = new Set(sandboxFiles)
  const addedFiles = sandboxFiles.filter((file) => !realSet.has(file))
  const deletedFiles = realFiles.filter((file) => !sandboxSet.has(file))
  const maybeModifiedFiles = sandboxFiles.filter((file) => realSet.has(file))
  const modifiedFiles: string[] = []
  for (const file of maybeModifiedFiles) {
    const [left, right] = await Promise.all([
      readFile(path.join(realPath, file)),
      readFile(path.join(sandboxPath, file)),
    ])
    if (!left.equals(right)) modifiedFiles.push(file)
  }
  return {
    addedFiles: addedFiles.sort(),
    modifiedFiles: modifiedFiles.sort(),
    deletedFiles: deletedFiles.sort(),
  }
}

async function applyDiffSummary(realPath: string, sandboxPath: string, summary: SandboxDiffSummary) {
  for (const file of summary.deletedFiles) {
    const target = path.join(realPath, file)
    requireSafeWorkspacePath(realPath, target)
    await rm(target, { recursive: true, force: true }).catch(() => {})
  }
  for (const file of [...summary.addedFiles, ...summary.modifiedFiles]) {
    const source = path.join(sandboxPath, file)
    const target = path.join(realPath, file)
    requireSafeWorkspacePath(realPath, target)
    await mkdir(path.dirname(target), { recursive: true })
    await copyFile(source, target)
  }
}

async function listRelativeFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === ".sandbox") continue
    const absolute = path.join(current, entry.name)
    const relative = path.relative(root, absolute).replace(/\\/g, "/")
    if (entry.isDirectory()) {
      files.push(...await listRelativeFiles(root, absolute))
      continue
    }
    if (!entry.isFile()) continue
    files.push(relative)
  }
  return files
}

function requireSafeWorkspacePath(root: string, target: string) {
  const relative = path.relative(root, target)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`sandbox diff path escapes workspace: ${target}`)
  }
}
