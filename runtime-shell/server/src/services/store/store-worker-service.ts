import * as WorkerRepo from "../../repos/worker-repo"
import type { User, WorkerNode } from "../../types"
import type { PersistState, ReadState } from "./store-domain-support"

export class StoreWorkerService {
  constructor(
    private readonly readState: ReadState,
    private readonly persist: PersistState,
  ) {}

  listWorkers() {
    return WorkerRepo.listAllWorkers()
  }

  async touchWorker(workerId: string, patch?: Partial<WorkerNode>) {
    return WorkerRepo.updateWorker(workerId, patch ?? {})
  }

  async reportWorkerHeartbeat(workerId: string, patch?: Partial<WorkerNode>) {
    return WorkerRepo.updateWorker(workerId, {
      ...patch,
      lastHeartbeatAt: new Date().toISOString(),
    })
  }

  async registerWorker(input: {
    workerId?: string
    tenantId?: string
    organizationId?: string
    workerCode: string
    name: string
    baseUrl: string
    capacity: number
    version?: string
  }) {
    return WorkerRepo.registerWorker(input)
  }

  async findWorkerById(workerId: string) {
    return WorkerRepo.findWorkerById(workerId)
  }

  async listReadyWorkersForUser(user: User) {
    return WorkerRepo.listReadyWorkersForUser(user)
  }

  async listWorkersByStatus(statuses: WorkerNode["status"][]) {
    return WorkerRepo.listWorkersByStatus(statuses)
  }

  async listWorkersHeartbeatExpired(expireBefore: string) {
    return WorkerRepo.listWorkersHeartbeatExpired(expireBefore)
  }
}
