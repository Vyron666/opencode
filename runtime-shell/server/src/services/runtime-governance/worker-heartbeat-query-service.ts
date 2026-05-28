import * as WorkerHeartbeatRepo from "../../repos/worker-heartbeat-repo"

export async function hasWorkerHeartbeat(workerId: string) {
  return WorkerHeartbeatRepo.hasWorkerHeartbeat(workerId)
}
