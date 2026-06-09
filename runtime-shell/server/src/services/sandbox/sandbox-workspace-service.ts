import { cp, mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { Config } from "../../config"
import { ensureSandboxUserOwnership } from "../../lib/sandbox-user-ownership"
import { createConcurrencyGate } from "../../lib/concurrency-gate"
import { isSystemWarmPoolSandboxInstance } from "../../lib/sandbox-instance-kind"
import {
  deleteSandboxInstanceByWorkspaceId,
  findSandboxInstanceByWorkspaceId,
  listSandboxInstances,
  upsertSandboxInstance,
} from "../../repos/sandbox-instance-repo"
import * as RuntimeLeaseRepo from "../../repos/runtime-lease-repo"
import {
  deleteSandboxWorkspaceByWorkspaceId,
  findSandboxWorkspaceByWorkspaceId,
  listSandboxWorkspacesForCleanup,
  upsertSandboxWorkspace,
} from "../../repos/sandbox-workspace-repo"
import type { BusinessSession, SandboxWorkspace } from "../../types"
import { runColdStartWorkspacePrepare } from "../../worker-agent/sandbox/docker-sandbox-cold-start"
import { removeColdRuntimeHomesByWorkspace } from "../../worker-agent/sandbox/docker-sandbox-runtime-home"
import { queryRemoteRuntimeForSession } from "../system/remote-runtime-observe-service"
import { auditService, sessionService } from "../store/store-singleton"
import { readSandboxBackend } from "./sandbox-backend"
import {
  hasLiveWorkspaceSessions,
  hasReusableWorkspaceSessions,
} from "./sandbox-workspace-liveness"
import {
  isDirectoryEmpty,
  isSandboxWorkLayerPath,
  persistWorkspaceFromSandbox,
} from "./sandbox-workspace-sync"

const sandboxWorkspacePreparations = new Map<string, Promise<SandboxWorkspace>>()
const runWithSandboxWorkspaceGate = createConcurrencyGate(Config.sandboxWorkspacePrepareConcurrency)
const STALE_PREPARED_SANDBOX_GRACE_MS = 10 * 60 * 1000
const STALE_INACTIVE_SANDBOX_GRACE_MS = 10 * 60 * 1000

export async function ensureSandboxWorkspace(session: BusinessSession) {
  const existing = await findSandboxWorkspaceByWorkspaceId(session.workspaceId)
  if (existing && existing.status !== "closed") return existing

  const inFlight = sandboxWorkspacePreparations.get(session.workspaceId)
  if (inFlight) return inFlight

  const preparation = prepareSandboxWorkspace(session)
  sandboxWorkspacePreparations.set(session.workspaceId, preparation)
  try {
    return await preparation
  } finally {
    if (sandboxWorkspacePreparations.get(session.workspaceId) === preparation) {
      sandboxWorkspacePreparations.delete(session.workspaceId)
    }
  }
}

async function prepareSandboxWorkspace(session: BusinessSession) {
  return runWithSandboxWorkspaceGate(async () => runColdStartWorkspacePrepare(async () => {
    const existing = await findSandboxWorkspaceByWorkspaceId(session.workspaceId)
    if (existing && existing.status !== "closed") return existing
    const sandboxPath = path.join(Config.workspaceRootDir, ".sandbox", session.workspaceId)
    await rm(sandboxPath, { recursive: true, force: true }).catch(() => {})
    await mkdir(path.dirname(sandboxPath), { recursive: true })
    if (await isDirectoryEmpty(session.workspacePath)) {
      // 中文/English: a brand-new workspace can skip the first full copy; the
      // managed sandbox root only needs to exist before the first write.
      await mkdir(sandboxPath, { recursive: true })
      await ensureSandboxUserOwnership(sandboxPath)
    } else {
      await cp(session.workspacePath, sandboxPath, {
        recursive: true,
        force: true,
        // 中文/English: never nest the managed sandbox work layer into itself.
        filter: (source) => !isSandboxWorkLayerPath({
          workspaceRootDir: Config.workspaceRootDir,
          source,
        }),
      })
      await ensureSandboxUserOwnership(sandboxPath)
    }
    const now = new Date().toISOString()
    const workspace: SandboxWorkspace = {
      // 中文/English: one workspace owns one sandbox copy; sessions only reference it.
      id: existing?.id || `sbw_${session.workspaceId}`,
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
    const instance = await findSandboxInstanceByWorkspaceId(session.workspaceId)
    await upsertSandboxInstance({
      id: instance?.id || `sbi_${session.workspaceId}`,
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
      createdAt: instance?.createdAt || now,
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
      resourceId: `sbi_${session.workspaceId}`,
      detail: {
        backend: readSandboxBackend(),
        sandboxPath,
        workspacePath: session.workspacePath,
        workspaceId: session.workspaceId,
      },
    })
    return workspace
  }))
}

export async function markSandboxWorkspaceClosing(sessionId: string) {
  const session = await sessionService.getSession(sessionId)
  if (!session) return
  if (await hasLiveSessions(session.workspaceId, [session.id])) return
  const existing = await findSandboxWorkspaceByWorkspaceId(session.workspaceId)
  if (!existing) return
  await upsertSandboxWorkspace({
    ...existing,
    businessSessionId: session.id,
    status: "closing",
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + Config.sandboxWorkspaceTtlMs).toISOString(),
  })
  const instance = await findSandboxInstanceByWorkspaceId(session.workspaceId)
  await upsertSandboxInstance({
    id: instance?.id || `sbi_${session.workspaceId}`,
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
    createdAt: instance?.createdAt || existing.createdAt,
    updatedAt: new Date().toISOString(),
    detail: {
      workspacePath: session.workspacePath,
    },
  })
}

export async function closeSandboxWorkspace(sessionId: string) {
  const session = await sessionService.getSession(sessionId)
  if (!session) return
  if (await hasLiveSessions(session.workspaceId, [session.id])) return
  const existing = await findSandboxWorkspaceByWorkspaceId(session.workspaceId)
  if (!existing) return
  await persistSandboxWorkspace(existing)
  const instance = await findSandboxInstanceByWorkspaceId(session.workspaceId)
  const now = new Date().toISOString()
  await upsertSandboxWorkspace({
    ...existing,
    businessSessionId: session.id,
    status: "closed",
    updatedAt: now,
    closedAt: now,
    expiresAt: new Date(Date.now() + Config.sandboxWorkspaceTtlMs).toISOString(),
  })
  await upsertSandboxInstance({
    id: instance?.id || `sbi_${session.workspaceId}`,
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
    createdAt: instance?.createdAt || existing.createdAt,
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
    resourceId: `sbi_${session.workspaceId}`,
    detail: {
      sandboxPath: existing.sandboxPath,
      workspacePath: session.workspacePath,
      workspaceId: session.workspaceId,
    },
  })
}

export async function markSandboxWorkspaceRunning(session: BusinessSession) {
  const existing = await findSandboxWorkspaceByWorkspaceId(session.workspaceId)
  if (!existing) return
  const instance = await findSandboxInstanceByWorkspaceId(session.workspaceId)
  const now = new Date().toISOString()
  const remoteRuntime = await queryRemoteRuntimeForSession(session)
  const remoteSandbox = readRemoteRuntimeSandbox(remoteRuntime)
  await upsertSandboxInstance({
    id: instance?.id || `sbi_${session.workspaceId}`,
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
    createdAt: instance?.createdAt || existing.createdAt,
    updatedAt: now,
    openedAt: now,
    detail: {
      workspacePath: session.workspacePath,
      ...remoteSandbox,
    },
  })
}

export async function getSandboxWorkspace(workspaceId: string) {
  return findSandboxWorkspaceByWorkspaceId(workspaceId)
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
    if (isSystemWarmPoolSandboxInstance(sandbox)) continue
    if (sandbox.status !== "ready" && sandbox.status !== "preparing" && sandbox.status !== "failed") continue
    if (Date.now() - new Date(sandbox.updatedAt).getTime() < STALE_PREPARED_SANDBOX_GRACE_MS) continue
    const session = await sessionService.getSession(sandbox.businessSessionId)
    if (!session) {
      const workspace = await findSandboxWorkspaceByWorkspaceId(sandbox.workspaceId)
      if (workspace) {
        await cleanupSandboxWorkspaceRecord(workspace)
      } else {
        await deleteSandboxInstanceByWorkspaceId(sandbox.workspaceId)
      }
      results.push({
        sessionId: sandbox.businessSessionId,
        cleaned: true,
      })
      continue
    }
    if (await hasLiveSessions(session.workspaceId, [session.id])) continue
    if (
      session.status !== "created" &&
      session.status !== "completed" &&
      session.status !== "failed" &&
      session.status !== "orphaned"
    ) continue
    const workspace = await findSandboxWorkspaceByWorkspaceId(session.workspaceId)
    if (workspace) {
      await cleanupSandboxWorkspaceRecord(workspace)
    } else {
      await closeInactiveSandboxWorkspace(session, sandbox)
    }
    results.push({
      sessionId: session.id,
      cleaned: true,
    })
  }
  return results
}

export async function cleanupStaleInactiveSandboxInstances(limit = 100) {
  const sandboxes = await listSandboxInstances(Math.max(limit * 3, limit))
  const results: Array<{
    sessionId: string
    cleaned: boolean
  }> = []
  for (const sandbox of sandboxes) {
    if (results.length >= limit) break
    if (isSystemWarmPoolSandboxInstance(sandbox)) continue
    if (sandbox.status === "warm" || sandbox.status === "leased") continue
    if (sandbox.status === "ready" || sandbox.status === "preparing") continue
    if (Date.now() - new Date(sandbox.updatedAt).getTime() < STALE_INACTIVE_SANDBOX_GRACE_MS) continue
    const session = await sessionService.getSession(sandbox.businessSessionId)
    if (!session) {
      const workspace = await findSandboxWorkspaceByWorkspaceId(sandbox.workspaceId)
      if (workspace) {
        await cleanupSandboxWorkspaceRecord(workspace)
      } else {
        await deleteSandboxInstanceByWorkspaceId(sandbox.workspaceId)
      }
      results.push({
        sessionId: sandbox.businessSessionId,
        cleaned: true,
      })
      continue
    }
    if (await hasReusableSessions(session.workspaceId, [session.id])) continue
    if (session.status === "orphaned") {
      if (await RuntimeLeaseRepo.findLeaseBySessionId(session.id)) continue
      // 中文/English: orphaned sessions may still reopen from the workspace copy,
      // but a stale sandbox_instance must not keep reporting a live running sandbox.
      await deleteSandboxInstanceByWorkspaceId(session.workspaceId)
      results.push({
        sessionId: session.id,
        cleaned: true,
      })
      continue
    }
    if (
      session.status !== "created" &&
      session.status !== "completed" &&
      session.status !== "failed"
    ) continue
    const workspace = await findSandboxWorkspaceByWorkspaceId(session.workspaceId)
    if (workspace) {
      await cleanupSandboxWorkspaceRecord(workspace)
    } else {
      await deleteSandboxInstanceByWorkspaceId(session.workspaceId)
    }
    results.push({
      sessionId: session.id,
      cleaned: true,
    })
  }
  return results
}

export async function cleanupClosedSandboxWorkspace(sessionId: string) {
  const session = await sessionService.getSession(sessionId)
  if (!session) {
    return {
      sessionId,
      cleaned: false,
      reason: "session_not_found",
    }
  }
  if (await hasReusableSessions(session.workspaceId, [session.id])) {
    return {
      sessionId,
      cleaned: false,
      reason: "workspace_still_in_use",
    }
  }
  const workspace = await findSandboxWorkspaceByWorkspaceId(session.workspaceId)
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

export async function purgeSandboxWorkspaceByWorkspaceId(workspaceId: string) {
  const workspace = await findSandboxWorkspaceByWorkspaceId(workspaceId)
  if (workspace) {
    await cleanupSandboxWorkspaceRecord(workspace)
    return
  }
  await removeColdRuntimeHomesByWorkspace(workspaceId)
  await deleteSandboxInstanceByWorkspaceId(workspaceId)
}

async function cleanupSandboxWorkspaces(workspaces: SandboxWorkspace[]) {
  const results: Array<{
    sessionId: string
    cleaned: boolean
  }> = []
  for (const workspace of workspaces) {
    if (await hasReusableSessions(workspace.workspaceId)) continue
    await cleanupSandboxWorkspaceRecord(workspace)
    results.push({
      sessionId: workspace.businessSessionId,
      cleaned: true,
    })
  }
  return results
}

async function cleanupSandboxWorkspaceRecord(workspace: SandboxWorkspace) {
  // 中文/English: cleanup touches only a workspace sandbox that is already closed
  // and no longer referenced by any resumable session.
  await persistSandboxWorkspace(workspace)
  await rm(workspace.sandboxPath, { recursive: true, force: true }).catch(() => {})
  await removeColdRuntimeHomesByWorkspace(workspace.workspaceId)
  await deleteSandboxInstanceByWorkspaceId(workspace.workspaceId)
  await deleteSandboxWorkspaceByWorkspaceId(workspace.workspaceId)
}

async function closeInactiveSandboxWorkspace(session: BusinessSession, sandbox: {
  id: string
  createdAt: string
  sandboxPath: string
}) {
  const workspace = await findSandboxWorkspaceByWorkspaceId(session.workspaceId)
  if (workspace) {
    await persistSandboxWorkspace(workspace)
  }
  const now = new Date().toISOString()
  if (workspace && workspace.status !== "closed") {
    await upsertSandboxWorkspace({
      ...workspace,
      businessSessionId: session.id,
      status: "closed",
      updatedAt: now,
      closedAt: workspace.closedAt || now,
      expiresAt: workspace.expiresAt || new Date(Date.now() + Config.sandboxWorkspaceTtlMs).toISOString(),
    })
  }
  await upsertSandboxInstance({
    id: sandbox.id,
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
    sandboxPath: workspace?.sandboxPath || sandbox.sandboxPath,
    createdAt: sandbox.createdAt,
    updatedAt: now,
    closedAt: now,
    detail: {
      workspacePath: session.workspacePath,
    },
  })
}

async function hasReusableSessions(workspaceId: string, excludedSessionIds: string[] = []) {
  return hasReusableWorkspaceSessions({ sessionService, workspaceId, excludedSessionIds })
}

async function hasLiveSessions(workspaceId: string, excludedSessionIds: string[] = []) {
  return hasLiveWorkspaceSessions({ sessionService, workspaceId, excludedSessionIds })
}

async function persistSandboxWorkspace(workspace: SandboxWorkspace) {
  return persistWorkspaceFromSandbox({
    workspacePath: workspace.workspacePath,
    sandboxPath: workspace.sandboxPath,
    runWithGate: runWithSandboxWorkspaceGate,
    ensureOwnership: ensureSandboxUserOwnership,
  })
}

function readRemoteRuntimeSandbox(remoteRuntime: unknown) {
  if (!remoteRuntime || typeof remoteRuntime !== "object") return {}
  const sandbox = (remoteRuntime as { sandbox?: unknown }).sandbox
  if (!sandbox || typeof sandbox !== "object") return {}
  const detail = sandbox as {
    containerName?: unknown
    source?: unknown
    poolSlotId?: unknown
    runtimeCwd?: unknown
  }
  return {
    containerName: typeof detail.containerName === "string" ? detail.containerName : undefined,
    source: typeof detail.source === "string" ? detail.source : undefined,
    poolSlotId: typeof detail.poolSlotId === "string" ? detail.poolSlotId : undefined,
    runtimeCwd: typeof detail.runtimeCwd === "string" ? detail.runtimeCwd : undefined,
  }
}
