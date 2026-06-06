import * as SessionRuntimeBindingRepo from "../../repos/session-runtime-binding-repo"
import { refreshWorkerLoad } from "../scheduler/scheduler-service"

export async function createRuntimeBinding(input: {
  businessSessionId: string
  workerId: string
}) {
  const binding = await SessionRuntimeBindingRepo.createBinding({
    businessSessionId: input.businessSessionId,
    workerId: input.workerId,
    bindingStatus: "binding",
  })
  await refreshWorkerLoad(input.workerId)
  return binding
}

export async function getActiveRuntimeBinding(sessionId: string) {
  return SessionRuntimeBindingRepo.findActiveBindingBySessionId(sessionId)
}

export async function getLatestRuntimeBinding(sessionId: string) {
  return SessionRuntimeBindingRepo.findLatestBindingBySessionId(sessionId)
}

export async function markRuntimeBindingBound(input: {
  sessionId: string
  acpSessionId: string
  runtimeKey: string
}) {
  const binding = await SessionRuntimeBindingRepo.findActiveBindingBySessionId(input.sessionId)
  if (!binding) return
  const updated = await SessionRuntimeBindingRepo.updateBinding(binding.id, {
    acpSessionId: input.acpSessionId,
    runtimeKey: input.runtimeKey,
    bindingStatus: "bound",
  })
  await refreshWorkerLoad(binding.workerId)
  return updated
}

export async function releaseRuntimeBinding(sessionId: string) {
  const binding = await SessionRuntimeBindingRepo.findActiveBindingBySessionId(sessionId)
  if (!binding) return
  const updated = await SessionRuntimeBindingRepo.updateBinding(binding.id, {
    bindingStatus: "released",
    releasedAt: new Date().toISOString(),
  })
  await refreshWorkerLoad(binding.workerId)
  return updated
}

export async function markRuntimeBindingLost(sessionId: string) {
  const binding = await SessionRuntimeBindingRepo.findActiveBindingBySessionId(sessionId)
  if (!binding) return
  const updated = await SessionRuntimeBindingRepo.updateBinding(binding.id, {
    bindingStatus: "lost",
  })
  await refreshWorkerLoad(binding.workerId)
  return updated
}

export async function deleteRuntimeBindingsBySessionIds(sessionIds: string[]) {
  if (sessionIds.length === 0) return
  await SessionRuntimeBindingRepo.deleteBindingsBySessionIds(sessionIds)
}
