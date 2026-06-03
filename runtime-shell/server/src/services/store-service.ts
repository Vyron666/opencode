import { createLogger } from "../log"
import { ensureDatabaseBootstrap } from "../db/bootstrap"
import { StoreAuditService } from "./store/store-audit-service"
import { StoreAuthService } from "./store/store-auth-service"
import { StoreSessionService } from "./store/store-session-service"
import { StoreStateService } from "./store/store-state-service"
import { StoreUserService } from "./store/store-user-service"
import { StoreWorkerService } from "./store/store-worker-service"
import { StoreWorkspaceShareService } from "./store/store-workspace-share-service"
import { StoreWorkspaceService } from "./store/store-workspace-service"

const log = createLogger("store")

export class StoreService {
  readonly stateService = new StoreStateService(log)
  readonly userService = new StoreUserService(() => this.stateService.readState())
  readonly authService = new StoreAuthService()
  readonly workspaceService = new StoreWorkspaceService(
    () => this.stateService.readState(),
    () => this.stateService.save(),
  )
  readonly workerService = new StoreWorkerService(
    () => this.stateService.readState(),
    () => this.stateService.save(),
  )
  readonly sessionService = new StoreSessionService(
    () => this.stateService.readState(),
    () => this.stateService.save(),
    log,
  )
  readonly workspaceShareService = new StoreWorkspaceShareService()
  readonly auditService = new StoreAuditService()

  async load() {
    await this.stateService.load()
    await ensureDatabaseBootstrap(this.stateService.readState())
  }
}
