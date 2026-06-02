import {
  appendConversationEvent,
  finalizeConversationView,
} from '../../components/chat/conversation-blocks'
import { publishAssistantChunk } from './assistant-stream-channel'
import { deriveCapPatch, mergeCapabilities } from '../capabilities'
import {
  deriveRuntimeFlags,
  shouldStartRunning,
  shouldStopSending,
} from '../runtime-phase'
import { convergeInteractionState, mergeSessionDetail } from '../session-events'

let eventSourceInstance = null
let reconnectTimer = null
let disposeActiveStream = null

export function createSseActions(input) {
  return {
    connectSSE: () => {
      const currentSessionId = input.get().currentSessionId
      if (!currentSessionId) return
      const previousReconnectAttempt = input.get().reconnectAttempt

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
        const nextEvents = queuedEvents.splice(0, queuedEvents.length)
        const shouldSyncResolvedInteractions = nextEvents.some(
          (event) => event?.eventType === 'permission_resolved' || event?.eventType === 'question_resolved',
        )

        input.set((state) => {
          if (stopped || state.activeSSESessionId !== currentSessionId) return {}
          let pendingPermissions = state.pendingPermissions
          let pendingQuestions = state.pendingQuestions
          let respondingPermissionIds = state.respondingPermissionIds
          let respondingQuestionIds = state.respondingQuestionIds
          let capabilities = state.capabilities
          let isSubmitting = state.isSubmitting
          let isRunning = state.isRunning
          let awaitingTurnRestart = state.awaitingTurnRestart
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

            const capabilityPatch = deriveCapPatch(event)
            capabilities = capabilityPatch ? mergeCapabilities(capabilities, capabilityPatch) : capabilities
            const nextRuntimeFlags = deriveRuntimeFlags(
              { isRunning, awaitingTurnRestart },
              event,
            )
            const runningChanged = nextRuntimeFlags.isRunning !== isRunning
            const structureChanged =
              state.conversationState.blocks.length !== previousConversationBlockCount ||
              state.conversationState.lastAssistantKey !== previousLastAssistantKey
            const canStreamAssistantChunk = shouldStreamAssistantChunk({
              isRunning,
              runningChanged,
              structureChanged,
              latestAssistantBlock,
              latestAssistantIndex,
              renderedBlock: latestAssistantIndex === undefined ? null : state.conversationBlocks[latestAssistantIndex],
            })

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
            isRunning = nextRuntimeFlags.isRunning
            awaitingTurnRestart = nextRuntimeFlags.awaitingTurnRestart
            // 中文/English: even a "quiet" turn can jump straight from the user
            // prompt to `turn_completed`, so terminal restart flags must also clear
            // the optimistic submitting state instead of waiting for visible chunks.
            isSubmitting =
              shouldStartRunning(event) || shouldStopSending(event) || nextRuntimeFlags.awaitingTurnRestart
                ? false
                : isSubmitting
            isCancelling = shouldStopSending(event) ? false : isCancelling
            state.sessionDetail = mergeSessionDetail(state.sessionDetail, event)
          })

          const interactionState = convergeInteractionState({
            eventBuffer: state.eventBuffer,
            pendingPermissions,
            pendingQuestions,
            respondingPermissionIds,
            respondingQuestionIds,
          })
          pendingPermissions = interactionState.pendingPermissions
          pendingQuestions = interactionState.pendingQuestions
          respondingPermissionIds = interactionState.respondingPermissionIds
          respondingQuestionIds = interactionState.respondingQuestionIds
          const conversationView = shouldRefreshConversationBlocks
            ? finalizeConversationView({
                conversationState: state.conversationState,
                isRunning,
                eventBuffer: state.eventBuffer,
                pendingPermissions,
                pendingQuestions,
                respondingPermissionIds,
                respondingQuestionIds,
              })
            : null

          return {
            eventBuffer: state.eventBuffer,
            eventBufferVersion: state.eventBufferVersion + nextEvents.length,
            seenEventIds: state.seenEventIds,
            conversationState: state.conversationState,
            conversationBlocks: conversationView ? conversationView.conversationBlocks : state.conversationBlocks,
            conversationVersion: conversationView ? conversationView.conversationVersion : state.conversationVersion,
            sessionDetail: state.sessionDetail,
            pendingPermissions,
            pendingQuestions,
            respondingPermissionIds,
            respondingQuestionIds,
            capabilities,
            isSubmitting,
            isRunning,
            awaitingTurnRestart,
            isCancelling,
            isConnected: true,
            reconnectAttempt: 0,
          }
        })

        if (!shouldSyncResolvedInteractions) return
        queueMicrotask(() => {
          if (stopped || input.get().activeSSESessionId !== currentSessionId) return
          // 中文/English: permission/question resolve can arrive back-to-back with
          // persisted summary updates, so reload once here to force the browser
          // phase banner and pending counters to converge on the authoritative view.
          void input.get().loadSessionDetail().catch(() => {})
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
        const reconnectAttempt = input.get().reconnectAttempt
        input.set({ isConnected: false })
        if (reconnectAttempt === 0) {
          input.get().setFlash('会话连接已中断，正在自动重连...')
        }
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
      if (previousReconnectAttempt > 0) {
        input.get().setFlash('会话连接已恢复')
      }
    },

    disconnectSSE: () => {
      disposeActiveStream?.()
      disposeActiveStream = null
      if (eventSourceInstance) {
        eventSourceInstance.close()
        eventSourceInstance = null
      }
      clearTimeout(reconnectTimer)
      input.set({ isConnected: false, reconnectAttempt: 0, activeSSESessionId: '' })
    },
  }
}

export function shouldStreamAssistantChunk(input) {
  if (!input.isRunning) return false
  if (input.runningChanged || input.structureChanged) return false
  if (!input.latestAssistantBlock || input.latestAssistantIndex === undefined) return false
  if (!input.renderedBlock) return false
  return input.renderedBlock.key === input.latestAssistantBlock.key && input.renderedBlock.streaming === true
}
