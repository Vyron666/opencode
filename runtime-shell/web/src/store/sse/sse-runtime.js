import {
  appendConversationEvent,
  finalizeConversationBlocks,
} from '../../components/chat/conversation-blocks'
import { publishAssistantChunk } from './assistant-stream-channel'
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
let disposeActiveStream = null

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
      let stopped = false

      const flushQueuedEvents = () => {
        flushScheduled = false
        if (stopped) return
        if (!queuedEvents.length) return

        input.set((state) => {
          if (stopped || state.activeSSESessionId !== currentSessionId) return {}
          const nextEvents = queuedEvents.splice(0, queuedEvents.length)
          let pendingPermissions = state.pendingPermissions
          let pendingQuestions = state.pendingQuestions
          let respondingPermissionIds = state.respondingPermissionIds
          let respondingQuestionIds = state.respondingQuestionIds
          let capabilities = state.capabilities
          let isSubmitting = state.isSubmitting
          let isRunning = state.isRunning
          let isCancelling = state.isCancelling
          let shouldRefreshConversationBlocks = false

          nextEvents.forEach((event) => {
            if (event.eventId && state.seenEventIds.has(event.eventId)) return
            if (event.eventId) state.seenEventIds.add(event.eventId)
            state.eventBuffer.push(event)
            ////////////// runtime-shell customization start //////////////
            // 中文/English: only rebuild rendered blocks when the conversation
            // structure or the running phase changes; later assistant chunks stream
            // through a dedicated side channel instead of React props churn.
            const previousLastAssistantKey = state.conversationState.lastAssistantKey
            const previousConversationBlockCount = state.conversationState.blocks.length
            appendConversationEvent(state.conversationState, event, false)
            const latestBlocks = state.conversationState.latestBlocks
            const latestAssistantBlock = latestBlocks.length === 1 && latestBlocks[0]?.type === 'assistant' ? latestBlocks[0] : null
            const latestAssistantIndex = latestAssistantBlock
              ? state.conversationState.blockIndexes.get(latestAssistantBlock.key)
              : undefined
            ////////////// runtime-shell customization end //////////////

            pendingPermissions = reducePendingPermissions(pendingPermissions, event)
            pendingQuestions = reducePendingQuestions(pendingQuestions, event)
            respondingPermissionIds = resolveRespondingPermissionIds(respondingPermissionIds, event)
            respondingQuestionIds = resolveRespondingQuestionIds(respondingQuestionIds, event)
            const capabilityPatch = deriveCapPatch(event)
            capabilities = capabilityPatch ? mergeCapabilities(capabilities, capabilityPatch) : capabilities
            const nextRunning = deriveRunningState(isRunning, event)
            const runningChanged = nextRunning !== isRunning
            const structureChanged =
              state.conversationState.blocks.length !== previousConversationBlockCount ||
              state.conversationState.lastAssistantKey !== previousLastAssistantKey
            const canStreamAssistantChunk =
              !runningChanged &&
              !structureChanged &&
              latestAssistantBlock &&
              latestAssistantIndex !== undefined &&
              state.conversationBlocks[latestAssistantIndex]?.key === latestAssistantBlock.key

            if (canStreamAssistantChunk && latestAssistantBlock.latestChunk) {
              publishAssistantChunk(
                latestAssistantBlock.key,
                latestAssistantBlock.latestChunk,
                latestAssistantBlock.chunkVersion,
              )
            }

            shouldRefreshConversationBlocks =
              shouldRefreshConversationBlocks ||
              runningChanged ||
              structureChanged ||
              !canStreamAssistantChunk
            isRunning = nextRunning
            isSubmitting = shouldStartRunning(event) || shouldStopSending(event) ? false : isSubmitting
            isCancelling = shouldStopSending(event) ? false : isCancelling
            state.sessionDetail = mergeSessionDetail(state.sessionDetail, event)
          })

          return {
            eventBuffer: state.eventBuffer,
            eventBufferVersion: state.eventBufferVersion + nextEvents.length,
            seenEventIds: state.seenEventIds,
            conversationState: state.conversationState,
            conversationBlocks: shouldRefreshConversationBlocks
              ? finalizeConversationBlocks(state.conversationState, isRunning)
              : state.conversationBlocks,
            conversationVersion: shouldRefreshConversationBlocks
              ? state.conversationState.latestVersion
              : state.conversationVersion,
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
        queueMicrotask(flushQueuedEvents)
      }

      const onEvent = (event) => {
        if (stopped) return
        if (input.get().activeSSESessionId !== currentSessionId) return
        queuedEvents.push(event)
        scheduleFlush()
      }

      const onError = () => {
        if (stopped) return
        input.set({ isConnected: false })
        const reconnectAttempt = input.get().reconnectAttempt
        const delay = Math.min(1000 * 2 ** reconnectAttempt, 15000)
        input.set({ reconnectAttempt: reconnectAttempt + 1 })
        clearTimeout(reconnectTimer)
        reconnectTimer = setTimeout(() => input.get().connectSSE(), delay)
      }

      disposeActiveStream = () => {
        stopped = true
        queuedEvents.length = 0
        flushScheduled = false
      }

      eventSourceInstance = input.createEventSource(currentSessionId, onEvent, onError, lastEventId)
      input.set({ isConnected: true, reconnectAttempt: 0 })
    },

    disconnectSSE: () => {
      disposeActiveStream?.()
      disposeActiveStream = null
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
