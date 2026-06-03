import type { BusinessSession, User } from "../../types"
import { createLogger } from "../../log"
import {
  releaseWorkerSelectionReservation,
  resolveStickyWorkerForSession,
  selectWorkerForNewSession,
} from "../scheduler/scheduler-service"
import { createRuntimeBinding, getActiveRuntimeBinding, markRuntimeBindingLost } from "../runtime-governance/runtime-binding-service"
import { sessionService } from "../store/store-singleton"

const log = createLogger("session-worker-assignment-service")

export async function assignWorkerForNewSession(user: User) {
  return selectWorkerForNewSession(user)
}

export async function assignWorkerForNewSessionWithReservation(user: User, reservationId: string) {
  return selectWorkerForNewSession(user, [], reservationId)
}

export async function ensureWorkerForSessionOpen(input: {
  user: User
  session: BusinessSession
}) {
  const reservationId = toSessionOpenReservationId(input.session.id)
  const stickyWorker = await resolveStickyWorkerForSession(input.session)
  if (stickyWorker) {
    releaseWorkerSelectionReservation(reservationId)
    log.info("session using sticky worker", {
      businessSessionId: input.session.id,
      workerId: stickyWorker.id,
      workspacePath: input.session.workspacePath,
    })
    await ensureRuntimeBindingForWorker(input.session.id, stickyWorker.id)
    return stickyWorker
  }

  const worker = await selectWorkerForNewSession(input.user, [], reservationId)
  if (!worker) {
    releaseWorkerSelectionReservation(reservationId)
    log.warn("session worker selection returned empty", {
      businessSessionId: input.session.id,
      previousWorkerId: input.session.workerId,
      workspacePath: input.session.workspacePath,
    })
    return
  }
  try {
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
  } finally {
    releaseWorkerSelectionReservation(reservationId)
  }
}

export async function reassignWorkerForSessionOpen(input: {
  user: User
  session: BusinessSession
  excludedWorkerIds: string[]
}) {
  const reservationId = toSessionOpenReservationId(input.session.id)
  const worker = await selectWorkerForNewSession(input.user, input.excludedWorkerIds, reservationId)
  if (!worker) {
    releaseWorkerSelectionReservation(reservationId)
    log.warn("session worker failover returned empty", {
      businessSessionId: input.session.id,
      previousWorkerId: input.session.workerId,
      excludedWorkerIds: input.excludedWorkerIds,
      workspacePath: input.session.workspacePath,
    })
    return
  }
  try {
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
  } finally {
    releaseWorkerSelectionReservation(reservationId)
  }
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

function toSessionOpenReservationId(sessionId: string) {
  return `session-open:${sessionId}`
}
