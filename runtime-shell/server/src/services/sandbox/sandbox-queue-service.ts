import * as RuntimeOperationQueueRepo from "../../repos/runtime-operation-queue-repo"
import { now, nextId } from "../../store/state-support"
import type { RuntimeOperationQueueItem, RuntimeOperationStage, RuntimeOperationType, User } from "../../types"

export async function startRuntimeOperation(input: {
  user: User
  projectId: string
  businessSessionId?: string
  workerId?: string
  operationType: RuntimeOperationType
  idempotencyKey?: string
  detail?: Record<string, unknown>
}) {
  const timestamp = now()
  const item: RuntimeOperationQueueItem = {
    id: nextId("rop"),
    tenantId: input.user.tenantId,
    organizationId: input.user.organizationId,
    projectId: input.projectId,
    userId: input.user.id,
    businessSessionId: input.businessSessionId,
    workerId: input.workerId,
    operationType: input.operationType,
    status: "queued",
    idempotencyKey: input.idempotencyKey,
    detail: input.detail,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  await RuntimeOperationQueueRepo.createRuntimeOperation(item)
  return item
}

export async function markRuntimeOperationStage(input: {
  operationId: string
  stage: RuntimeOperationStage
  workerId?: string
  detail?: Record<string, unknown>
}) {
  const timestamp = now()
  await RuntimeOperationQueueRepo.updateRuntimeOperationStage({
    id: input.operationId,
    stage: input.stage,
    updatedAt: timestamp,
    stageStartedAt: timestamp,
    workerId: input.workerId,
    detail: input.detail,
  })
}

export async function markRuntimeOperationRunning(operationId: string, workerId?: string) {
  const timestamp = now()
  await RuntimeOperationQueueRepo.updateRuntimeOperation({
    id: operationId,
    status: "running",
    updatedAt: timestamp,
    startedAt: timestamp,
    workerId,
    detail: {
      stage: "runtime_open",
      startedAt: timestamp,
    },
  })
}

export async function markRuntimeOperationCompleted(operationId: string) {
  const timestamp = now()
  await RuntimeOperationQueueRepo.updateRuntimeOperation({
    id: operationId,
    status: "completed",
    updatedAt: timestamp,
    completedAt: timestamp,
    detail: {
      stage: "completed",
      completedAt: timestamp,
    },
  })
}

export async function markRuntimeOperationFailed(operationId: string, errorMessage: string) {
  const timestamp = now()
  await RuntimeOperationQueueRepo.updateRuntimeOperation({
    id: operationId,
    status: "failed",
    updatedAt: timestamp,
    completedAt: timestamp,
    errorMessage,
    detail: {
      failedAt: timestamp,
    },
  })
}

export async function markRuntimeOperationRejected(operationId: string, errorMessage: string) {
  const timestamp = now()
  await RuntimeOperationQueueRepo.updateRuntimeOperation({
    id: operationId,
    status: "rejected",
    updatedAt: timestamp,
    completedAt: timestamp,
    errorMessage,
    detail: {
      rejectedAt: timestamp,
    },
  })
}

export async function listRuntimeOperations(limit?: number) {
  return RuntimeOperationQueueRepo.listRuntimeOperations(limit)
}
