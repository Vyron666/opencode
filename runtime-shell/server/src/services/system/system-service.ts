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
  return {
    ok: true as const,
    items: await workerService.listWorkers(),
    opencode: await getOpencodeHealth(),
  }
}
