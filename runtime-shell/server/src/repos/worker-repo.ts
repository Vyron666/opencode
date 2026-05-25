import { now } from "../store/state-support"
import type { PersistedState, WorkerNode } from "../types"
import { listWorkers, updateWorker } from "./state-repo"

export function listAllWorkers(state: PersistedState) {
  return listWorkers(state)
}

export function touchWorker(state: PersistedState, workerId: string, patch?: Partial<WorkerNode>) {
  return updateWorker(state, workerId, {
    ...patch,
    lastHeartbeatAt: now(),
  })
}
