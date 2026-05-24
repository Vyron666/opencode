import {
  appendConversationEvent,
  finalizeConversationBlocks,
} from '../../components/chat/conversation-blocks'
import { deriveCapPatch, mergeCapabilities } from '../capabilities'
import {
  deriveRunningState,
  shouldStartRunning,
  shouldStopSending,
} from '../runtime-phase'
import {
  mergeSessionDetail,
  reducePendingPermissions,
  reducePendingQuestions,
} from '../session-events'

let eventSourceInstance = null
let reconnectTimer = null

export function createSseActions(input) {
  return {
    connectSSE: () => {
      const currentSessionId = input.get().currentSessionId
      if (!currentSessionId) return

      const lastEventId = [...input.get().eventBuffer]
        .reverse()
        .find((event) => typeof event?.eventId === 'string' && !String(event.eventType || '').endsWith('_local'))?.eventId

      input.get().disconnectSSE()
      input.set({ activeSSESessionId: currentSessionId })
      const queuedEvents = []
      let flushScheduled = false

      const flushQueuedEvents = () => {
        flushScheduled = false
        if (!queuedEvents.length) return

        input.set((state) => {
          const nextEvents = queuedEvents.splice(0, queuedEvents.length)
          let pendingPermissions = state.pendingPermissions
          let pendingQuestions = state.pendingQuestions
          let respondingPermissionIds = state.respondingPermissionIds
          let respondingQuestionIds = state.respondingQuestionIds
          let capabilities = state.capabilities
          let isSubmitting = state.isSubmitting
          let isRunning = state.isRunning
          let isCancelling = state.isCancelling

          nextEvents.forEach((event) => {
            if (event.eventId && state.seenEventIds.has(event.eventId)) return
            if (event.eventId) state.seenEventIds.add(event.eventId)
            state.eventBuffer.push(event)
            ////////////// runtime-shell customization start //////////////
            // 中文/English: apply one animation-frame batch so the UI keeps streaming
            // in order without paying one full Zustand + React update per chunk.
            appendConversationEvent(state.conversationState, event, false)
            ////////////// runtime-shell customization end //////////////

            pendingPermissions = reducePendingPermissions(pendingPermissions, event)
            pendingQuestions = reducePendingQuestions(pendingQuestions, event)
            respondingPermissionIds = resolveRespondingPermissionIds(respondingPermissionIds, event)
            respondingQuestionIds = resolveRespondingQuestionIds(respondingQuestionIds, event)
            const capabilityPatch = deriveCapPatch(event)
            capabilities = capabilityPatch ? mergeCapabilities(capabilities, capabilityPatch) : capabilities
            isRunning = deriveRunningState(isRunning, event)
            isSubmitting = shouldStartRunning(event) || shouldStopSending(event) ? false : isSubmitting
            isCancelling = shouldStopSending(event) ? false : isCancelling
            state.sessionDetail = mergeSessionDetail(state.sessionDetail, event)
          })

          return {
            eventBuffer: state.eventBuffer,
            eventBufferVersion: state.eventBufferVersion + nextEvents.length,
            seenEventIds: state.seenEventIds,
            conversationState: state.conversationState,
            conversationBlocks: finalizeConversationBlocks(state.conversationState, isRunning),
            sessionDetail: state.sessionDetail,
            pendingPermissions,
            pendingQuestions,
            respondingPermissionIds,
            respondingQuestionIds,
            capabilities,
            isSubmitting,
            isRunning,
            isCancelling,
            isConnected: true,
            reconnectAttempt: 0,
          }
        })
      }

      const scheduleFlush = () => {
        if (flushScheduled) return
        flushScheduled = true
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(flushQueuedEvents)
          return
        }
        setTimeout(flushQueuedEvents, 0)
      }

      const onEvent = (event) => {
        if (input.get().activeSSESessionId !== currentSessionId) return
        queuedEvents.push(event)
        scheduleFlush()
      }

      const onError = () => {
        input.set({ isConnected: false })
        const reconnectAttempt = input.get().reconnectAttempt
        const delay = Math.min(1000 * 2 ** reconnectAttempt, 15000)
        input.set({ reconnectAttempt: reconnectAttempt + 1 })
        clearTimeout(reconnectTimer)
        reconnectTimer = setTimeout(() => input.get().connectSSE(), delay)
      }

      eventSourceInstance = input.createEventSource(currentSessionId, onEvent, onError, lastEventId)
      input.set({ isConnected: true, reconnectAttempt: 0 })
    },

    disconnectSSE: () => {
      if (eventSourceInstance) {
        eventSourceInstance.close()
        eventSourceInstance = null
      }
      clearTimeout(reconnectTimer)
      input.set({ isConnected: false, activeSSESessionId: '' })
    },
  }
}

function resolveRespondingPermissionIds(current, event) {
  if (event.eventType !== 'permission_resolved') return current
  const requestId = event.payload?.requestId
  if (!requestId) return current
  const next = new Set(current)
  next.delete(requestId)
  return next
}

function resolveRespondingQuestionIds(current, event) {
  if (event.eventType !== 'question_resolved') return current
  const requestId = event.payload?.requestId
  if (!requestId) return current
  const next = new Set(current)
  next.delete(requestId)
  return next
}
