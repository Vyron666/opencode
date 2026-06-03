import { cp, mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { Config } from "../../config"
import { createConcurrencyGate } from "../../lib/concurrency-gate"
import {
  deleteSandboxInstanceBySessionId,
  listSandboxInstances,
  upsertSandboxInstance,
} from "../../repos/sandbox-instance-repo"
import {
  deleteSandboxWorkspaceBySessionId,
  findSandboxWorkspaceBySessionId,
  listSandboxWorkspacesForCleanup,
  upsertSandboxWorkspace,
} from "../../repos/sandbox-workspace-repo"
import type { BusinessSession, SandboxBackend, SandboxWorkspace } from "../../types"
import { auditService, sessionService } from "../store/store-singleton"

const sandboxWorkspacePreparations = new Map<string, Promise<SandboxWorkspace>>()
const runWithSandboxWorkspaceGate = createConcurrencyGate(Config.sandboxWorkspacePrepareConcurrency)
const STALE_PREPARED_SANDBOX_GRACE_MS = 10 * 60 * 1000

export async function ensureSandboxWorkspace(session: BusinessSession) {
  const existing = await findSandboxWorkspaceBySessionId(session.id)
  if (existing && existing.status !== "closed") return existing

  const inFlight = sandboxWorkspacePreparations.get(session.id)
  if (inFlight) return inFlight

  const preparation = prepareSandboxWorkspace(session)
  sandboxWorkspacePreparations.set(session.id, preparation)
  try {
    return await preparation
  } finally {
    if (sandboxWorkspacePreparations.get(session.id) === preparation) {
      sandboxWorkspacePreparations.delete(session.id)
    }
  }
}

async function prepareSandboxWorkspace(session: BusinessSession) {
  return runWithSandboxWorkspaceGate(async () => {
    const existing = await findSandboxWorkspaceBySessionId(session.id)
    if (existing && existing.status !== "closed") return existing
    const sandboxPath = path.join(Config.workspaceRootDir, ".sandbox", session.id)
    await rm(sandboxPath, { recursive: true, force: true }).catch(() => {})
    await mkdir(path.dirname(sandboxPath), { recursive: true })
    await cp(session.workspacePath, sandboxPath, {
      recursive: true,
      force: true,
      // 中文/English: never copy runtime-shell's controlled sandbox work layer
      // into a new sandbox copy, especially when historical sessions point at
      // the workspace root itself.
      filter: (source) => !isSandboxWorkLayerPath(source),
    })
    const now = new Date().toISOString()
    const workspace: SandboxWorkspace = {
      id: existing?.id || `sbw_${crypto.randomUUID().replace(/-/g, "")}`,
      businessSessionId: session.id,
      workspaceId: session.workspaceId,
      workspacePath: session.workspacePath,
      sandboxPath,
      status: "ready",
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + Config.sandboxWorkspaceTtlMs).toISOString(),
    }
    await upsertSandboxWorkspace(workspace)
    await upsertSandboxInstance({
      id: `sbi_${session.id}`,
      tenantId: session.tenantId,
      organizationId: session.organizationId,
      projectId: session.projectId,
      workspaceId: session.workspaceId,
      businessSessionId: session.id,
      workerId: session.workerId,
      backend: readSandboxBackend(),
      runtimeClass: Config.sandboxRuntimeClass || undefined,
      isolationMode: Config.sandboxIsolationMode || undefined,
      status: "ready",
      sandboxPath,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      detail: {
        workspacePath: session.workspacePath,
      },
    })
    void auditService.appendAuditLog({
      tenantId: session.tenantId,
      organizationId: session.organizationId,
      projectId: session.projectId,
      businessSessionId: session.id,
      action: "sandbox.create",
      resourceType: "sandbox_instance",
      resourceId: `sbi_${session.id}`,
      detail: {
        backend: readSandboxBackend(),
        sandboxPath,
        workspacePath: session.workspacePath,
      },
    })
    return workspace
  })
}

export async function markSandboxWorkspaceClosing(sessionId: string) {
  const existing = await findSandboxWorkspaceBySessionId(sessionId)
  if (!existing) return
  const session = await sessionService.getSession(sessionId)
  await upsertSandboxWorkspace({
    ...existing,
    status: "closing",
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + Config.sandboxWorkspaceTtlMs).toISOString(),
  })
  if (!session) return
  await upsertSandboxInstance({
    id: `sbi_${session.id}`,
    tenantId: session.tenantId,
    organizationId: session.organizationId,
    projectId: session.projectId,
    workspaceId: session.workspaceId,
    businessSessionId: session.id,
    workerId: session.workerId,
    backend: readSandboxBackend(),
    runtimeClass: Config.sandboxRuntimeClass || undefined,
    isolationMode: Config.sandboxIsolationMode || undefined,
    status: "closing",
    sandboxPath: existing.sandboxPath,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
    detail: {
      workspacePath: session.workspacePath,
    },
  })
}

export async function closeSandboxWorkspace(sessionId: string) {
  const existing = await findSandboxWorkspaceBySessionId(sessionId)
  if (!existing) return
  const session = await sessionService.getSession(sessionId)
  const now = new Date().toISOString()
  await upsertSandboxWorkspace({
    ...existing,
    status: "closed",
    updatedAt: now,
    closedAt: now,
    expiresAt: new Date(Date.now() + Config.sandboxWorkspaceTtlMs).toISOString(),
  })
  if (!session) return
  await upsertSandboxInstance({
    id: `sbi_${session.id}`,
    tenantId: session.tenantId,
    organizationId: session.organizationId,
    projectId: session.projectId,
    workspaceId: session.workspaceId,
    businessSessionId: session.id,
    workerId: session.workerId,
    backend: readSandboxBackend(),
    runtimeClass: Config.sandboxRuntimeClass || undefined,
    isolationMode: Config.sandboxIsolationMode || undefined,
    status: "closed",
    sandboxPath: existing.sandboxPath,
    createdAt: existing.createdAt,
    updatedAt: now,
    closedAt: now,
    detail: {
      workspacePath: session.workspacePath,
    },
  })
  void auditService.appendAuditLog({
    tenantId: session.tenantId,
    organizationId: session.organizationId,
    projectId: session.projectId,
    businessSessionId: session.id,
    action: "sandbox.close",
    resourceType: "sandbox_instance",
    resourceId: `sbi_${session.id}`,
    detail: {
      sandboxPath: existing.sandboxPath,
      workspacePath: session.workspacePath,
    },
  })
}

export async function markSandboxWorkspaceRunning(session: BusinessSession) {
  const existing = await findSandboxWorkspaceBySessionId(session.id)
  if (!existing) return
  const now = new Date().toISOString()
  await upsertSandboxInstance({
    id: `sbi_${session.id}`,
    tenantId: session.tenantId,
    organizationId: session.organizationId,
    projectId: session.projectId,
    workspaceId: session.workspaceId,
    businessSessionId: session.id,
    workerId: session.workerId,
    backend: readSandboxBackend(),
    runtimeClass: Config.sandboxRuntimeClass || undefined,
    isolationMode: Config.sandboxIsolationMode || undefined,
    status: "running",
    sandboxPath: existing.sandboxPath,
    createdAt: existing.createdAt,
    updatedAt: now,
    openedAt: now,
    detail: {
      workspacePath: session.workspacePath,
    },
  })
}

export async function getSandboxWorkspace(sessionId: string) {
  return findSandboxWorkspaceBySessionId(sessionId)
}

export async function cleanupExpiredSandboxWorkspaces(limit = 100) {
  const workspaces = await listSandboxWorkspacesForCleanup({
    limit,
    includeUnexpiredClosed: false,
  })
  return cleanupSandboxWorkspaces(workspaces)
}

export async function cleanupClosedSandboxWorkspaces(limit = 100) {
  const workspaces = await listSandboxWorkspacesForCleanup({
    limit,
    includeUnexpiredClosed: true,
  })
  return cleanupSandboxWorkspaces(workspaces)
}

export async function cleanupStalePreparedSandboxWorkspaces(limit = 100) {
  const sandboxes = await listSandboxInstances(Math.max(limit * 3, limit))
  const results: Array<{
    sessionId: string
    cleaned: boolean
  }> = []
  for (const sandbox of sandboxes) {
    if (results.length >= limit) break
    if (sandbox.detail?.source === "warm_pool") continue
    if (sandbox.status !== "ready" && sandbox.status !== "preparing" && sandbox.status !== "failed") continue
    if (Date.now() - new Date(sandbox.updatedAt).getTime() < STALE_PREPARED_SANDBOX_GRACE_MS) continue
    const session = await sessionService.getSession(sandbox.businessSessionId)
    if (!session) {
      await deleteSandboxInstanceBySessionId(sandbox.businessSessionId)
      results.push({
        sessionId: sandbox.businessSessionId,
        cleaned: true,
      })
      continue
    }
    if (
      session.status !== "created" &&
      session.status !== "completed" &&
      session.status !== "failed" &&
      session.status !== "orphaned"
    ) continue
    const workspace = await findSandboxWorkspaceBySessionId(session.id)
    if (workspace) {
      await cleanupSandboxWorkspaceRecord(workspace)
    } else {
      await deleteSandboxInstanceBySessionId(session.id)
    }
    results.push({
      sessionId: session.id,
      cleaned: true,
    })
  }
  return results
}

export async function cleanupClosedSandboxWorkspace(sessionId: string) {
  const workspace = await findSandboxWorkspaceBySessionId(sessionId)
  if (!workspace || workspace.status !== "closed") {
    return {
      sessionId,
      cleaned: false,
      reason: "workspace_not_closed",
    }
  }
  await cleanupSandboxWorkspaceRecord(workspace)
  return {
    sessionId,
    cleaned: true,
  }
}

async function cleanupSandboxWorkspaces(workspaces: SandboxWorkspace[]) {
  const results: Array<{
    sessionId: string
    cleaned: boolean
  }> = []
  for (const workspace of workspaces) {
    await cleanupSandboxWorkspaceRecord(workspace)
    results.push({
      sessionId: workspace.businessSessionId,
      cleaned: true,
    })
  }
  return results
}

async function cleanupSandboxWorkspaceRecord(workspace: SandboxWorkspace) {
  // 中文/English: cleanup only touches already-closed sandbox copies, so active
  // or reopening sessions never lose their writable layer under them.
  await rm(workspace.sandboxPath, { recursive: true, force: true }).catch(() => {})
  await deleteSandboxInstanceBySessionId(workspace.businessSessionId)
  await deleteSandboxWorkspaceBySessionId(workspace.businessSessionId)
}

function isSandboxWorkLayerPath(source: string) {
  const relative = path.relative(path.join(Config.workspaceRootDir, ".sandbox"), source)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function readSandboxBackend(): SandboxBackend {
  if (Config.sandboxBackend === "gvisor") return "gvisor"
  if (Config.sandboxBackend === "kata") return "kata"
  if (Config.sandboxBackend === "docker") return "docker"
  return "local-process"
}
