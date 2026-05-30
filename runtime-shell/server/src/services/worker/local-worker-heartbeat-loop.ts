import { Config } from "../../config"
import { createLogger } from "../../log"
import { recordWorkerHeartbeat } from "../runtime-governance/worker-heartbeat-service"
import { sessionService, workerService } from "../store/store-singleton"

const log = createLogger("local-worker-heartbeat")
const CREATED_SESSION_RESERVATION_MS = 30000
const LOCAL_WORKER_HEALTH_TIMEOUT_MS = 3000

let localWorkerHeartbeatTimer: Timer | undefined

export function startLocalWorkerHeartbeatLoop() {
  if (localWorkerHeartbeatTimer) return
  void beatLocalWorker()
  localWorkerHeartbeatTimer = setInterval(() => {
    void beatLocalWorker().catch((error) => {
      log.warn("local worker heartbeat failed", {
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }, readHeartbeatIntervalMs())
}

export async function refreshLocalWorkersNow() {
  await beatLocalWorker()
}

function readHeartbeatIntervalMs() {
  return Math.min(Math.max(Math.floor(Config.workerHeartbeatTimeoutMs / 3), 1000), 10000)
}

async function beatLocalWorker() {
  const sessions = await sessionService.listSessions()
  await Promise.all(
    Config.localWorkers.map(async (localWorker) => {
      const worker = await workerService.findWorkerById(localWorker.id)
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
        await workerService.touchWorker(localWorker.id, {
          activeSessionCount,
          status: "offline",
        })
        return
      }
      const status = activeSessionCount >= worker.capacity ? "busy" : "ready"
      await recordWorkerHeartbeat({
        workerId: localWorker.id,
        capacityUsed: activeSessionCount,
        status,
      })
      await workerService.reportWorkerHeartbeat(localWorker.id, {
        activeSessionCount,
        status,
      })
    }),
  )
}

async function isLocalWorkerReachable(worker: { baseUrl: string; agentBaseUrl?: string }) {
  try {
    const response = await fetch(`${worker.baseUrl}/global/health`, {
      headers: readLocalWorkerAuthHeaders(),
      signal: AbortSignal.timeout(LOCAL_WORKER_HEALTH_TIMEOUT_MS),
    })
    if (!response.ok) return false
    if (Config.workerExecutionMode !== "remote" || !worker.agentBaseUrl) return true
    const agentResponse = await fetch(`${worker.agentBaseUrl}/healthz`, {
      headers: {
        "x-runtime-worker-token": Config.workerAgentToken,
      },
      signal: AbortSignal.timeout(LOCAL_WORKER_HEALTH_TIMEOUT_MS),
    })
    return agentResponse.ok
  } catch (error) {
    log.warn("local worker probe failed", {
      baseUrl: worker.baseUrl,
      agentBaseUrl: worker.agentBaseUrl,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
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
