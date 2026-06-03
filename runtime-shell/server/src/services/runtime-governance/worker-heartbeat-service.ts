import * as WorkerHeartbeatRepo from "../../repos/worker-heartbeat-repo"

export async function recordWorkerHeartbeat(input: {
  workerId: string
  capacityUsed: number
  status: "registering" | "ready" | "busy" | "degraded" | "offline" | "draining"
  resourceSummary?: import("../../types").WorkerHeartbeat["resourceSummary"]
}) {
  return WorkerHeartbeatRepo.createWorkerHeartbeat(input)
}
