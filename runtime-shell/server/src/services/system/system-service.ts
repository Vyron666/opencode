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
    items: workers.filter((worker) => shouldExposeWorker(worker)),
    opencode: await getOpencodeHealth(),
  }
}

function shouldExposeWorker(
  worker: Awaited<ReturnType<typeof workerService.listWorkers>>[number],
) {
  // 中文/English: the dashboard should show the configured worker pool only.
  return Config.localWorkers.some((localWorker) => localWorker.id === worker.id)
  // 中文/English: keep recently failed remote workers visible for debugging,
  // but hide stale historical test nodes so the worker view stays readable.
}
