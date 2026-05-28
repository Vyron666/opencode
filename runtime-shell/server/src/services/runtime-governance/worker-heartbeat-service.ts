import * as WorkerHeartbeatRepo from "../../repos/worker-heartbeat-repo"

export async function recordWorkerHeartbeat(input: {
  workerId: string
  capacityUsed: number
  status: "registering" | "ready" | "busy" | "degraded" | "offline" | "draining"
}) {
  return WorkerHeartbeatRepo.createWorkerHeartbeat(input)
}
