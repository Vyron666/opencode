import { getOpencodeHealth } from "../../opencode"
import { workerService } from "../store/store-singleton"
import type { User } from "../../types"

export async function getHealthOverview() {
  return {
    status: "ok",
    opencode: await getOpencodeHealth(),
  }
}

export async function getWorkerOverviewForUser(_user: User) {
  const workers = workerService.listWorkers()
  const opencode = await getOpencodeHealth()
  const first = workers[0]
  if (first) {
    // 中文/English: keep the local worker view aligned with upstream health until dedicated heartbeats exist.
    await workerService.touchWorker(first.id, {
      status: opencode.healthy ? "ready" : "offline",
    })
  }
  return {
    items: workerService.listWorkers(),
    opencode,
  }
}
