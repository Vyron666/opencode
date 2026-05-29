import { Config } from "../../config"
import type { User } from "../../types"
import { getOpencodeHealth } from "../../opencode"
import { authorizeSystemWorkersAccess } from "../access/authorization-service"
import { workerService } from "../store/store-singleton"

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
    items: workers.filter((worker) => shouldExposeWorker(worker, workers)),
    opencode: await getOpencodeHealth(),
  }
}

function shouldExposeWorker(
  worker: Awaited<ReturnType<typeof workerService.listWorkers>>[number],
  workers: Awaited<ReturnType<typeof workerService.listWorkers>>,
) {
  if (Config.localWorkers.some((localWorker) => localWorker.id === worker.id)) return true
  if (worker.status !== "offline") return true
  if (worker.activeSessionCount > 0) return true
  const lastHeartbeatAgeMs = Date.now() - new Date(worker.lastHeartbeatAt).getTime()
  // 中文/English: keep recently failed remote workers visible for debugging,
  // but hide stale historical test nodes so the worker view stays readable.
  if (lastHeartbeatAgeMs <= Config.workerHeartbeatTimeoutMs * 2) return true
  const sameCodeWorkers = workers.filter((item) => item.workerCode === worker.workerCode)
  return sameCodeWorkers.length === 1 && worker.workerCode.startsWith("worker_local")
}
