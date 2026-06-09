import { Config } from "../../config"
import { isSystemWarmPoolSandboxInstance } from "../../lib/sandbox-instance-kind"
import { createLogger } from "../../log"
import * as RuntimeOperationQueueRepo from "../../repos/runtime-operation-queue-repo"
import * as SandboxInstanceRepo from "../../repos/sandbox-instance-repo"
import { listWarmRuntimeDemandBuckets } from "../sandbox/warm-runtime-demand-service"
import type { SandboxInstance } from "../../types"
import { recordWorkerHeartbeat } from "../runtime-governance/worker-heartbeat-service"
import { readSandboxBackend } from "../sandbox/sandbox-backend"
import { registerWorkerForUser } from "./worker-service"
import { sessionService, userService, workerService } from "../store/store-singleton"

const log = createLogger("local-worker-heartbeat")
const CREATED_SESSION_RESERVATION_MS = 30000
const LOCAL_WORKER_HEALTH_TIMEOUT_MS = 3000
const LOCAL_WARM_POOL_ENSURE_TIMEOUT_MS = Math.max(
  LOCAL_WORKER_HEALTH_TIMEOUT_MS,
  Math.min(Config.workerHeartbeatTimeoutMs, 15000),
)

let localWorkerHeartbeatTimer: Timer | undefined
let pendingLocalWorkerHeartbeat: Promise<void> | undefined

export function startLocalWorkerHeartbeatLoop() {
  if (localWorkerHeartbeatTimer) return
  void runLocalWorkerHeartbeat()
  localWorkerHeartbeatTimer = setInterval(() => {
    void runLocalWorkerHeartbeat()
  }, readHeartbeatIntervalMs())
}

export function stopLocalWorkerHeartbeatLoop() {
  if (!localWorkerHeartbeatTimer) return
  clearInterval(localWorkerHeartbeatTimer)
  localWorkerHeartbeatTimer = undefined
}

export async function refreshLocalWorkersNow() {
  await runLocalWorkerHeartbeat()
}

function readHeartbeatIntervalMs() {
  return Math.min(Math.max(Math.floor(Config.workerHeartbeatTimeoutMs / 3), 1000), 10000)
}

async function beatLocalWorker() {
  const sessions = await sessionService.listSessionsByFilter({
    statuses: ["created", "opening", "active", "waiting_input", "cancelling", "closing"],
  })
  const adminUser = userService.findUser(Config.adminUsername)
  await Promise.all(
    Config.localWorkers.map(async (localWorker) => {
      const worker =
        (await workerService.findWorkerById(localWorker.id)) ||
        (adminUser
          ? (await registerWorkerForUser({
              user: adminUser,
              workerId: localWorker.id,
              nodeCode: localWorker.workerCode,
              endpoint:
                Config.workerExecutionMode === "remote"
                  ? (localWorker.agentBaseUrl || localWorker.baseUrl)
                  : localWorker.baseUrl,
              version: localWorker.version,
              capacityTotal: localWorker.capacity,
              name: localWorker.name,
              warmPoolTarget: localWorker.warmPoolTarget,
            })).worker
          : undefined)
      if (!worker) return
      const activeSessionCount = sessions.filter((session) =>
        session.workerId === localWorker.id &&
        (isWorkerReservedSession(session) ||
          session.status === "opening" ||
          session.status === "active" ||
          session.status === "waiting_input" ||
          session.status === "cancelling" ||
          session.status === "closing"),
      ).length
      if (!(await isLocalWorkerReachable(localWorker))) {
        // 中文/English: when the real worker endpoint is down, do not refresh heartbeat
        // timestamps here, otherwise governance can never observe the node as stale/offline.
        return
      }
      const configuredWarmPoolTarget = localWorker.warmPoolTarget ?? worker.warmPoolTarget ?? 0
      const [runningSandboxCount, queuedOperationCount, remoteHeartbeat] = await Promise.all([
        SandboxInstanceRepo.countBusinessSandboxInstancesByWorkerStatus(localWorker.id, ["preparing", "ready", "running"]),
        worker.tenantId && worker.organizationId
          ? RuntimeOperationQueueRepo.countRuntimeOperationsByScope({
              tenantId: worker.tenantId,
              organizationId: worker.organizationId,
              workerId: localWorker.id,
              statuses: ["queued", "running"],
            })
          : 0,
        queryRemoteWorkerHeartbeat(localWorker.agentBaseUrl, localWorker.id),
      ])
      const warmPoolTarget = readEffectiveWarmPoolTarget({
        configuredTarget: configuredWarmPoolTarget,
        capacity: worker.capacity,
        activeSessionCount,
        runningSandboxCount,
        queuedOperationCount,
      })
      const warmPoolSnapshot = await ensureRemoteWarmPool(worker, localWorker.agentBaseUrl, warmPoolTarget)
      const warmPoolReady = warmPoolSnapshot.readyCount
      const warmShellReady = warmPoolSnapshot.warmShellReadyCount ?? warmPoolReady
      await syncWarmPoolSandboxInstances(worker, warmPoolSnapshot)
      const resourceSummary = {
        // 中文/English: derive capacity stats from persisted runtime-shell state and
        // remote warm pool state so scheduling sees one consistent pressure model.
        runningSandboxCount,
        warmSandboxCount: warmShellReady,
        queuedOperationCount,
        cpuPercent: remoteHeartbeat.cpuPercent,
        memoryBytes: remoteHeartbeat.memoryBytes,
        diskBytes: remoteHeartbeat.diskBytes,
      }
      const status = activeSessionCount >= worker.capacity ? "busy" : "ready"
      await recordWorkerHeartbeat({
        workerId: localWorker.id,
        capacityUsed: activeSessionCount,
        status,
        resourceSummary,
      })
      await workerService.reportWorkerHeartbeat(localWorker.id, {
        activeSessionCount,
        status,
        resourceSummary,
        warmPoolTarget,
        warmPoolReady,
      })
    }),
  )
}

function readEffectiveWarmPoolTarget(input: {
  configuredTarget: number
  capacity: number
  activeSessionCount: number
  runningSandboxCount: number
  queuedOperationCount: number
}) {
  const livePressure = Math.max(input.activeSessionCount, input.runningSandboxCount)
  const queuePenalty = input.queuedOperationCount > 0 ? 1 : 0
  const spareCapacity = Math.max(0, input.capacity - livePressure - queuePenalty)
  return Math.min(input.configuredTarget, spareCapacity)
}

function runLocalWorkerHeartbeat() {
  if (pendingLocalWorkerHeartbeat) return pendingLocalWorkerHeartbeat
  const task = beatLocalWorker().catch((error) => {
    log.warn("local worker heartbeat failed", {
      error: error instanceof Error ? error.message : String(error),
    })
  })
  const trackedTask = task.finally(() => {
    if (pendingLocalWorkerHeartbeat === trackedTask) {
      pendingLocalWorkerHeartbeat = undefined
    }
  })
  pendingLocalWorkerHeartbeat = trackedTask
  return trackedTask
}

async function queryRemoteWorkerHeartbeat(agentBaseUrl: string | undefined, workerId: string) {
  if (!agentBaseUrl || Config.workerExecutionMode !== "remote") {
    return {
      cpuPercent: undefined,
      memoryBytes: undefined,
      diskBytes: undefined,
    }
  }
  try {
    const response = await fetch(`${agentBaseUrl}/runtime/query-heartbeat?workerId=${encodeURIComponent(workerId)}`, {
      headers: {
        "x-runtime-worker-token": Config.workerAgentToken,
      },
      signal: AbortSignal.timeout(LOCAL_WORKER_HEALTH_TIMEOUT_MS),
    })
    if (!response.ok) {
      return {
        cpuPercent: undefined,
        memoryBytes: undefined,
        diskBytes: undefined,
      }
    }
    const payload = await response.json() as {
      cpuPercent?: number
      memoryBytes?: number
      diskBytes?: number
    }
    return {
      cpuPercent: typeof payload.cpuPercent === "number" ? payload.cpuPercent : undefined,
      memoryBytes: typeof payload.memoryBytes === "number" ? payload.memoryBytes : undefined,
      diskBytes: typeof payload.diskBytes === "number" ? payload.diskBytes : undefined,
    }
  } catch {
    return {
      cpuPercent: undefined,
      memoryBytes: undefined,
      diskBytes: undefined,
    }
  }
}

async function isLocalWorkerReachable(worker: { baseUrl: string; agentBaseUrl?: string }) {
  try {
    if (Config.workerExecutionMode === "remote" && worker.agentBaseUrl) {
      // 中文/English: remote runtime execution depends on worker-agent `4097`.
      // Do not mark the worker offline just because the legacy `4096` health
      // endpoint is slow or unavailable in the same time window.
      const agentResponse = await fetch(`${worker.agentBaseUrl}/healthz`, {
        headers: {
          "x-runtime-worker-token": Config.workerAgentToken,
        },
        signal: AbortSignal.timeout(LOCAL_WORKER_HEALTH_TIMEOUT_MS),
      })
      return agentResponse.ok
    }
    const response = await fetch(`${worker.baseUrl}/global/health`, {
      headers: readLocalWorkerAuthHeaders(),
      signal: AbortSignal.timeout(LOCAL_WORKER_HEALTH_TIMEOUT_MS),
    })
    return response.ok
  } catch (error) {
    log.warn("local worker probe failed", {
      baseUrl: worker.baseUrl,
      agentBaseUrl: worker.agentBaseUrl,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

async function ensureRemoteWarmPool(
  worker: { id: string; tenantId?: string; organizationId?: string },
  agentBaseUrl: string | undefined,
  target: number,
) {
  if (!agentBaseUrl || Config.workerExecutionMode !== "remote") {
    return {
      readyCount: 0,
      leasedCount: 0,
      target: 0,
      slots: [],
    }
  }
  try {
    const warmRuntimeBuckets = listWarmRuntimeDemandBuckets(target || 1)
    const response = await fetch(`${agentBaseUrl}/runtime/pool/ensure`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-runtime-worker-token": Config.workerAgentToken,
      },
      body: JSON.stringify({
        workerId: worker.id,
        target,
        warmRuntimeBuckets,
      }),
      // 中文/English: warm-pool ensure is a bounded control-plane operation, not a
      // liveness probe. It needs a longer timeout than `/healthz`, otherwise the
      // server sees `warmPoolReady=0` even while the worker is still building slots.
      signal: AbortSignal.timeout(LOCAL_WARM_POOL_ENSURE_TIMEOUT_MS),
    })
    if (!response.ok) {
      log.warn("remote warm pool ensure failed", {
        workerId: worker.id,
        target,
        status: response.status,
      })
      return {
        readyCount: 0,
        leasedCount: 0,
        target: 0,
        slots: [],
      }
    }
    const payload = await response.json() as {
      readyCount?: number
      leasedCount?: number
      target?: number
      warmShellReadyCount?: number
      slots?: Array<{
        slotId: string
        containerName: string
        visiblePath: string
        status: "warm" | "leased" | "preparing"
        createdAt: string
      }>
    }
    return {
      readyCount: typeof payload.readyCount === "number" ? payload.readyCount : 0,
      warmShellReadyCount: typeof payload.warmShellReadyCount === "number" ? payload.warmShellReadyCount : undefined,
      leasedCount: typeof payload.leasedCount === "number" ? payload.leasedCount : 0,
      target: typeof payload.target === "number" ? payload.target : target,
      slots: Array.isArray(payload.slots) ? payload.slots : [],
    }
  } catch (error) {
    log.warn("remote warm pool ensure failed", {
      workerId: worker.id,
      target,
      message: error instanceof Error ? error.message : String(error),
    })
    return {
      readyCount: 0,
      leasedCount: 0,
      target: 0,
      slots: [],
    }
  }
}

async function syncWarmPoolSandboxInstances(
  worker: {
    id: string
    tenantId?: string
    organizationId?: string
  },
  snapshot: {
    slots: Array<{
      slotId: string
      containerName: string
      visiblePath: string
      status: "warm" | "leased" | "preparing"
      createdAt: string
    }>
  },
) {
  if (!worker.tenantId || !worker.organizationId) return
  const existing = await SandboxInstanceRepo.listSandboxInstancesByWorker(worker.id)
  const warmIds = new Set(snapshot.slots.map((slot) => `warm_${worker.id}_${slot.slotId}`))
  await Promise.all(existing
    .filter((item) => isSystemWarmPoolSandboxInstance(item) && !warmIds.has(item.id))
    .map((item) => SandboxInstanceRepo.deleteSandboxInstanceById(item.id)))
  const now = new Date().toISOString()
  await Promise.all(snapshot.slots.map((slot) => {
    const instance: SandboxInstance = {
      id: `warm_${worker.id}_${slot.slotId}`,
      tenantId: worker.tenantId!,
      organizationId: worker.organizationId!,
      projectId: "__warm_pool__",
      // 中文/English: warm slots are synthetic system sandboxes, so each slot needs
      // its own synthetic workspace id instead of colliding on the real workspace
      // uniqueness constraint used by workspace-level sandboxes.
      workspaceId: `warm_pool:${worker.id}:${slot.slotId}`,
      businessSessionId: `warm_pool:${worker.id}:${slot.slotId}`,
      workerId: worker.id,
      backend: readSandboxBackend(),
      runtimeClass: Config.sandboxRuntimeClass || undefined,
      isolationMode: Config.sandboxIsolationMode || undefined,
      status: slot.status,
      sandboxPath: slot.visiblePath,
      createdAt: slot.createdAt,
      updatedAt: now,
      openedAt: slot.status === "leased" ? now : undefined,
      detail: {
        source: "warm_pool",
        slotId: slot.slotId,
        containerName: slot.containerName,
      },
    }
    return SandboxInstanceRepo.upsertSandboxInstance(instance)
  }))
}

function isWorkerReservedSession(session: { status: string; updatedAt: string }) {
  if (session.status !== "created") return false
  return Date.now() - new Date(session.updatedAt).getTime() <= CREATED_SESSION_RESERVATION_MS
}

function readLocalWorkerAuthHeaders() {
  const password = Config.opencodePassword
  if (!password) return undefined
  const token = Buffer.from(`${Config.opencodeUsername}:${password}`).toString("base64")
  return {
    Authorization: `Basic ${token}`,
  }
}
