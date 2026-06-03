import { Config } from "../../config"
import { closeRuntime } from "../../acp-runtime-manager"
import type { User } from "../../types"
import { getOpencodeHealth } from "../../opencode"
import * as SandboxInstanceRepo from "../../repos/sandbox-instance-repo"
import { authorizeSystemWorkersAccess } from "../access/authorization-service"
import {
  cleanupClosedSandboxWorkspace,
  cleanupClosedSandboxWorkspaces,
  cleanupStalePreparedSandboxWorkspaces,
  closeSandboxWorkspace,
  markSandboxWorkspaceClosing,
} from "../sandbox/sandbox-workspace-service"
import { listQuotaPolicies, saveQuotaPolicy } from "../sandbox/sandbox-quota-service"
import { listRuntimeOperations } from "../sandbox/sandbox-queue-service"
import { workerService, sessionService } from "../store/store-singleton"
import { markSessionOrphaned } from "../session/session-status-machine-service"
import { resetSessionRuntime } from "../session/session-lifecycle-service"

export async function getHealthOverview() {
  return {
    status: "ok",
    opencode: await getOpencodeHealth(),
  }
}

export async function getWorkerOverviewForUser(user: User) {
  const authorization = authorizeSystemWorkersAccess(user)
  if (!authorization.ok) return { ok: false as const, reason: "forbidden" }
  const workers = await workerService.listWorkers()
  return {
    ok: true as const,
    items: workers.filter((worker) => shouldExposeWorker(worker)),
    opencode: await getOpencodeHealth(),
  }
}

export async function getSandboxOverviewForUser(user: User, limit = 100) {
  const authorization = authorizeSystemWorkersAccess(user)
  if (!authorization.ok) return { ok: false as const, reason: "forbidden" }
  const items = await SandboxInstanceRepo.listSandboxInstances(limit)
  const summary = {
    running: items.filter((item) => item.status === "running").length,
    warm: items.filter((item) => item.status === "warm").length,
    leased: items.filter((item) => item.status === "leased").length,
    preparing: items.filter((item) => item.status === "preparing" || item.status === "ready").length,
    closing: items.filter((item) => item.status === "closing").length,
    closed: items.filter((item) => item.status === "closed").length,
    failed: items.filter((item) => item.status === "failed").length,
  }
  return {
    ok: true as const,
    items,
    summary,
  }
}

export async function getQueueOverviewForUser(user: User, limit = 100) {
  const authorization = authorizeSystemWorkersAccess(user)
  if (!authorization.ok) return { ok: false as const, reason: "forbidden" }
  return {
    ok: true as const,
    items: await listRuntimeOperations(limit),
  }
}

export async function getQuotaOverviewForUser(user: User) {
  const authorization = authorizeSystemWorkersAccess(user)
  if (!authorization.ok) return { ok: false as const, reason: "forbidden" }
  return {
    ok: true as const,
    items: await listQuotaPolicies({
      tenantId: user.tenantId,
      organizationId: user.organizationId,
    }),
  }
}

export async function updateQuotaForUser(input: {
  user: User
  tenantId: string
  organizationId: string
  scopeType: "tenant" | "organization" | "project" | "user"
  scopeId: string
  enabled: boolean
  maxActiveSessions?: number
  maxQueuedOperations?: number
  maxRunningSandboxes?: number
  maxWarmPoolPerWorker?: number
}) {
  const authorization = authorizeSystemWorkersAccess(input.user)
  if (!authorization.ok) return { ok: false as const, reason: "forbidden" }
  return {
    ok: true as const,
    item: await saveQuotaPolicy(input),
  }
}

export async function closeSandboxForUser(input: {
  user: User
  sandboxId: string
}) {
  const authorization = authorizeSystemWorkersAccess(input.user)
  if (!authorization.ok) return { ok: false as const, reason: "forbidden" }
  const sandbox = await SandboxInstanceRepo.findSandboxInstanceById(input.sandboxId)
  if (!sandbox) return { ok: false as const, reason: "sandbox_not_found" }
  if (sandbox.detail?.source === "warm_pool") {
    const slotId = typeof sandbox.detail.slotId === "string" ? sandbox.detail.slotId : ""
    if (!slotId) return { ok: false as const, reason: "invalid_warm_pool_slot" }
    const worker = Config.localWorkers.find((item) => item.id === sandbox.workerId)
    if (!worker) return { ok: false as const, reason: "worker_not_found" }
    const response = await fetch(`${worker.agentBaseUrl || worker.baseUrl.replace(/:\d+$/, ":4097")}/runtime/pool/close-slot`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-runtime-worker-token": Config.workerAgentToken,
      },
      body: JSON.stringify({
        workerId: sandbox.workerId,
        slotId,
      }),
    })
    if (!response.ok) {
      throw new Error(await response.text() || `close warm pool slot failed: ${response.status}`)
    }
    await SandboxInstanceRepo.deleteSandboxInstanceById(sandbox.id)
    return {
      ok: true as const,
      sandboxId: sandbox.id,
      mode: "warm_pool",
    }
  }

  const session = await sessionService.getSession(sandbox.businessSessionId)
  if (!session) return { ok: false as const, reason: "session_not_found" }
  await markSessionOrphaned(session.id)
  await markSandboxWorkspaceClosing(session.id)
  await closeRuntime(session.id)
  await resetSessionRuntime(session.id, "orphaned")
  await closeSandboxWorkspace(session.id)
  return {
    ok: true as const,
    sandboxId: sandbox.id,
    mode: "session",
  }
}

export async function cleanupSandboxesForUser(input: {
  user: User
  limit: number
  recycleWarmPoolReady: boolean
}) {
  const authorization = authorizeSystemWorkersAccess(input.user)
  if (!authorization.ok) return { ok: false as const, reason: "forbidden" }

  const sandboxes = await SandboxInstanceRepo.listSandboxInstances(Math.max(input.limit * 3, input.limit))
  const sessionStatusAllowlist = new Set(["completed", "failed", "orphaned", "closing"])
  const cleanedSessionIds: string[] = []

  for (const sandbox of sandboxes) {
    if (cleanedSessionIds.length >= input.limit) break
    if (sandbox.detail?.source === "warm_pool") continue
    const session = await sessionService.getSession(sandbox.businessSessionId)
    if (!session || !sessionStatusAllowlist.has(session.status)) continue
    if (sandbox.status !== "closed") {
      await markSandboxWorkspaceClosing(session.id)
      await closeRuntime(session.id).catch(() => false)
      await resetSessionRuntime(session.id, session.status === "completed" ? "completed" : "orphaned")
      await closeSandboxWorkspace(session.id)
    }
    const result = await cleanupClosedSandboxWorkspace(session.id)
    if (!result.cleaned) continue
    cleanedSessionIds.push(session.id)
  }

  const closedWorkspaceCleanup = await cleanupClosedSandboxWorkspaces(input.limit)
  const stalePreparedCleanup = await cleanupStalePreparedSandboxWorkspaces(input.limit)
  const warmPoolCleanup = await cleanupWarmPoolForAllWorkers(input.recycleWarmPoolReady)

  return {
    ok: true as const,
    cleanedSessionIds: [...new Set([
      ...cleanedSessionIds,
      ...closedWorkspaceCleanup.map((item) => item.sessionId),
      ...stalePreparedCleanup.map((item) => item.sessionId),
    ])],
    warmPoolCleanup,
  }
}

function shouldExposeWorker(
  worker: Awaited<ReturnType<typeof workerService.listWorkers>>[number],
) {
  // 中文/English: the dashboard should show the configured worker pool only.
  return Config.localWorkers.some((localWorker) => localWorker.id === worker.id)
}

async function cleanupWarmPoolForAllWorkers(recycleWarmPoolReady: boolean) {
  return Promise.all(Config.localWorkers.map(async (worker) => {
    const agentBaseUrl = worker.agentBaseUrl || worker.baseUrl.replace(/:\d+$/, ":4097")
    try {
      const response = await fetch(`${agentBaseUrl}/runtime/pool/cleanup`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-runtime-worker-token": Config.workerAgentToken,
        },
        body: JSON.stringify({
          workerId: worker.id,
          recycleReady: recycleWarmPoolReady,
        }),
      })
      if (!response.ok) {
        return {
          workerId: worker.id,
          ok: false as const,
          reason: await response.text() || `cleanup failed: ${response.status}`,
        }
      }
      return {
        workerId: worker.id,
        ok: true as const,
        snapshot: await response.json() as Record<string, unknown>,
      }
    } catch (error) {
      return {
        workerId: worker.id,
        ok: false as const,
        reason: error instanceof Error ? error.message : String(error),
      }
    }
  }))
}
