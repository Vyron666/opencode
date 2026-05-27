import {
  listPendingPermissions,
  listPendingQuestions,
  resolvePendingPermission,
  resolvePendingQuestion,
  subscribeRuntimeEvents,
} from "../../acp-runtime-manager"
import type { PendingPermission, PendingQuestion, SessionEvent, User } from "../../types"
import { findBusinessSessionForUser } from "../session/session-access-service"
import { sessionService } from "../store/store-singleton"

async function visibleSessionIds(user: User) {
  return new Set((await sessionService.listUserSessions(user)).map((session) => session.id))
}

function writeSseEvent(controller: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder, event: SessionEvent) {
  controller.enqueue(encoder.encode(`id: ${event.eventId}\n`))
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
}

function writeSsePayload(controller: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder, payload: unknown) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
}

export async function listPendingPermissionsForUser(input: {
  user: User
  businessSessionId?: string
}) {
  if (input.businessSessionId) {
    const result = await findBusinessSessionForUser(input.businessSessionId, input.user)
    if (!result.ok) return result
    return {
      ok: true as const,
      items: listPendingPermissions(result.session.id),
    }
  }

  const sessionIds = await visibleSessionIds(input.user)
  return {
    ok: true as const,
    items: listPendingPermissions().filter((item) => sessionIds.has(item.businessSessionId)),
  }
}

export async function listPendingQuestionsForUser(input: {
  user: User
  businessSessionId?: string
}) {
  if (input.businessSessionId) {
    const result = await findBusinessSessionForUser(input.businessSessionId, input.user)
    if (!result.ok) return result
    return {
      ok: true as const,
      items: listPendingQuestions(result.session.id),
    }
  }

  const sessionIds = await visibleSessionIds(input.user)
  return {
    ok: true as const,
    items: listPendingQuestions().filter((item) => sessionIds.has(item.businessSessionId)),
  }
}

function findPermissionForSession(businessSessionId: string, requestId: string) {
  return listPendingPermissions(businessSessionId).find((item) => item.requestId === requestId)
}

function findQuestionForSession(businessSessionId: string, requestId: string) {
  return listPendingQuestions(businessSessionId).find((item) => item.requestId === requestId)
}

export async function respondPermissionForUser(input: {
  user: User
  businessSessionId: string
  requestId: string
  approved: boolean
  optionId?: string
}) {
  const result = await findBusinessSessionForUser(input.businessSessionId, input.user)
  if (!result.ok) return result
  const permission = findPermissionForSession(result.session.id, input.requestId)
  if (!permission) return { ok: false as const, reason: "permission_request_not_found" }

  const success = resolvePendingPermission(input.requestId, {
    approved: input.approved,
    optionId: input.optionId,
  })
  if (!success) return { ok: false as const, reason: "permission_request_not_found" }

  return {
    ok: true as const,
    permission,
  }
}

export async function respondQuestionForUser(input: {
  user: User
  businessSessionId: string
  requestId: string
  action: "accept" | "decline" | "cancel"
  content?: Record<string, unknown>
}) {
  const result = await findBusinessSessionForUser(input.businessSessionId, input.user)
  if (!result.ok) return result
  const question = findQuestionForSession(result.session.id, input.requestId)
  if (!question) return { ok: false as const, reason: "question_request_not_found" }

  const success = resolvePendingQuestion(input.requestId, {
    action: input.action,
    content: input.content,
  })
  if (!success) return { ok: false as const, reason: "question_request_not_found" }

  return {
    ok: true as const,
    question,
  }
}

export async function createEventStreamForUser(input: {
  user: User
  businessSessionId: string
  afterEventId?: string
  abortSignal: AbortSignal
}) {
  const result = await findBusinessSessionForUser(input.businessSessionId, input.user)
  if (!result.ok) return result

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      let replayingHistory = true
      const seenEventIds = new Set<string>()
      const queuedEvents: SessionEvent[] = []

      // 中文/English: subscribe first, then replay persisted history, so no event is lost in between.
      const cleanupRuntime = subscribeRuntimeEvents(result.session.id, (event) => {
        if (replayingHistory) {
          queuedEvents.push(event)
          return
        }
        if (closed || seenEventIds.has(event.eventId)) return
        seenEventIds.add(event.eventId)
        writeSseEvent(controller, encoder, event)
      })

      sessionService.listEvents(result.session.id, input.afterEventId).forEach((event) => {
        if (seenEventIds.has(event.eventId)) return
        seenEventIds.add(event.eventId)
        writeSseEvent(controller, encoder, event)
      })
      replayingHistory = false
      queuedEvents.forEach((event) => {
        if (seenEventIds.has(event.eventId)) return
        seenEventIds.add(event.eventId)
        writeSseEvent(controller, encoder, event)
      })

      writeSsePayload(controller, encoder, { type: "heartbeat", sessionId: result.session.id })
      const timer = setInterval(
        () => writeSsePayload(controller, encoder, { type: "heartbeat", sessionId: result.session.id }),
        5000,
      )

      input.abortSignal.addEventListener("abort", () => {
        if (closed) return
        closed = true
        clearInterval(timer)
        cleanupRuntime()
        controller.close()
      })
    },
  })

  return {
    ok: true as const,
    stream,
  }
}
