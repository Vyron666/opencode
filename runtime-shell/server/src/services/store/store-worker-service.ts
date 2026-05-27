import * as WorkerRepo from "../../repos/worker-repo"
import type { WorkerNode } from "../../types"
import type { PersistState, ReadState } from "./store-domain-support"

export class StoreWorkerService {
  constructor(
    private readonly readState: ReadState,
    private readonly persist: PersistState,
  ) {}

  listWorkers() {
    return WorkerRepo.listAllWorkers(this.readState())
  }

  async touchWorker(workerId: string, patch?: Partial<WorkerNode>) {
    const worker = WorkerRepo.touchWorker(this.readState(), workerId, patch)
    if (!worker) return
    await this.persist()
  }
}
