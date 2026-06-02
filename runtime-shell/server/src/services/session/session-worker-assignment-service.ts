import type { BusinessSession, User } from "../../types"
import { createLogger } from "../../log"
import { selectWorkerForNewSession, resolveStickyWorkerForSession } from "../scheduler/scheduler-service"
import { createRuntimeBinding, getActiveRuntimeBinding, markRuntimeBindingLost } from "../runtime-governance/runtime-binding-service"
import { sessionService } from "../store/store-singleton"

const log = createLogger("session-worker-assignment-service")

export async function assignWorkerForNewSession(user: User) {
  return selectWorkerForNewSession(user)
}

export async function ensureWorkerForSessionOpen(input: {
  user: User
  session: BusinessSession
}) {
  const stickyWorker = await resolveStickyWorkerForSession(input.session)
  if (stickyWorker) {
    log.info("session using sticky worker", {
      businessSessionId: input.session.id,
      workerId: stickyWorker.id,
      workspacePath: input.session.workspacePath,
    })
    await ensureRuntimeBindingForWorker(input.session.id, stickyWorker.id)
    return stickyWorker
  }

  const worker = await selectWorkerForNewSession(input.user)
  if (!worker) {
    log.warn("session worker selection returned empty", {
      businessSessionId: input.session.id,
      previousWorkerId: input.session.workerId,
      workspacePath: input.session.workspacePath,
    })
    return
  }
  if (input.session.workerId !== worker.id) {
    await sessionService.updateSession(input.session.id, {
      workerId: worker.id,
    })
  }
  if (input.session.workerId && input.session.workerId !== worker.id) {
    await markRuntimeBindingLost(input.session.id)
  }
  log.info("session selected worker", {
    businessSessionId: input.session.id,
    workerId: worker.id,
    workspacePath: input.session.workspacePath,
  })
  await ensureRuntimeBindingForWorker(input.session.id, worker.id)
  return worker
}

export async function reassignWorkerForSessionOpen(input: {
  user: User
  session: BusinessSession
  excludedWorkerIds: string[]
}) {
  const worker = await selectWorkerForNewSession(input.user, input.excludedWorkerIds)
  if (!worker) {
    log.warn("session worker failover returned empty", {
      businessSessionId: input.session.id,
      previousWorkerId: input.session.workerId,
      excludedWorkerIds: input.excludedWorkerIds,
      workspacePath: input.session.workspacePath,
    })
    return
  }
  if (input.session.workerId !== worker.id) {
    await sessionService.updateSession(input.session.id, {
      workerId: worker.id,
    })
  }
  if (input.session.workerId && input.session.workerId !== worker.id) {
    await markRuntimeBindingLost(input.session.id)
  }
  log.info("session failed over to worker", {
    businessSessionId: input.session.id,
    previousWorkerId: input.session.workerId,
    workerId: worker.id,
    workspacePath: input.session.workspacePath,
  })
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
