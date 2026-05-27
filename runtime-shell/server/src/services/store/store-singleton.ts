import { StoreService } from "../store-service"

const storeService = new StoreService()

export const runtimeStore = storeService
export const stateService = storeService.stateService
export const metadataService = storeService.metadataService
export const userService = storeService.userService
export const authService = storeService.authService
export const workspaceService = storeService.workspaceService
export const workerService = storeService.workerService
export const sessionService = storeService.sessionService
export const sessionShareService = storeService.sessionShareService
export const auditService = storeService.auditService
