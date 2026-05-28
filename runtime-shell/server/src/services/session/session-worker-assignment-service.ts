import type { BusinessSession, User } from "../../types"
import { selectWorkerForNewSession, resolveStickyWorkerForSession } from "../scheduler/scheduler-service"
import { createRuntimeBinding, getActiveRuntimeBinding, markRuntimeBindingLost } from "../runtime-governance/runtime-binding-service"
import { sessionService } from "../store/store-singleton"

export async function assignWorkerForNewSession(user: User) {
  return selectWorkerForNewSession(user)
}

export async function ensureWorkerForSessionOpen(input: {
  user: User
  session: BusinessSession
}) {
  const stickyWorker = await resolveStickyWorkerForSession(input.session)
  if (stickyWorker) {
    await ensureRuntimeBindingForWorker(input.session.id, stickyWorker.id)
    return stickyWorker
  }

  const worker = await selectWorkerForNewSession(input.user)
  if (!worker) return
  if (input.session.workerId !== worker.id) {
    await sessionService.updateSession(input.session.id, {
      workerId: worker.id,
    })
  }
  if (input.session.workerId && input.session.workerId !== worker.id) {
    await markRuntimeBindingLost(input.session.id)
  }
  await ensureRuntimeBindingForWorker(input.session.id, worker.id)
  return worker
}

async function ensureRuntimeBindingForWorker(sessionId: string, workerId: string) {
  const binding = await getActiveRuntimeBinding(sessionId)
  if (binding && binding.workerId === workerId && (binding.bindingStatus === "binding" || binding.bindingStatus === "bound")) {
    return binding
  }
  return createRuntimeBinding({
    businessSessionId: sessionId,
    workerId,
  })
}
