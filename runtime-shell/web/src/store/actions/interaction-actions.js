import {
  appendConversationEvent,
  finalizeConversationView,
} from '../../components/chat/conversation-blocks'
import { createRequestFailureHandler } from './interaction-action-support'
import { fileToBase64 } from '../file-parts'
import { convergeInteractionState, createLocalEvent } from '../session-events'

export function createInteractionActions(input) {
  return {
    sendPrompt: async (text, attachments) => {
      const currentSessionId = input.get().currentSessionId
      if (!currentSessionId || !text.trim()) return
      input.set({ isSubmitting: true, isRunning: false })
      const resetPromptState = { isSubmitting: false, isRunning: false, isCancelling: false }
      const parts = await buildPromptParts(text, attachments, currentSessionId, input.set).then(
        (value) => value,
        createRequestFailureHandler(input, resetPromptState, '附件处理失败'),
      )
      await input.api.sendInput(currentSessionId, parts).then(
        () => undefined,
        createRequestFailureHandler(input, resetPromptState, '消息发送失败'),
      )

      // 中文/English: once runtime-shell accepted the turn, switch to running early
      // so the user does not stare at a stale "submitting" state during cold-start gaps.
      input.set({ isSubmitting: false, isRunning: true, awaitingTurnRestart: false, isCancelling: false })
      input.get().setFlash(attachments?.length ? `消息已发送，包含 ${attachments.length} 个附件，模型正在处理` : '消息已发送，模型正在处理')
      return true
    },

    cancelPrompt: async () => {
      const currentSessionId = input.get().currentSessionId
      if (!currentSessionId) return
      input.set({ isCancelling: true })
      await input.api.cancelSessionPrompt(currentSessionId).then(
        () => undefined,
        (error) => {
          // 中文/English: a 409 here means upstream already ended the active turn.
          if (error?.status === 409) {
            input.set({
              isSubmitting: false,
              isRunning: false,
              awaitingTurnRestart: true,
              isCancelling: false,
            })
            input.get().setFlash('当前会话已经没有可取消的生成，已同步最新状态')
            return
          }
          return createRequestFailureHandler(input, { isCancelling: false }, '取消失败')(error)
        },
      )
      input.set({ isSubmitting: false })
    },

    setPendingPermissions: (items) => input.set({ pendingPermissions: items }),
    setPendingQuestions: (items) => input.set({ pendingQuestions: items }),

    respondPermission: async (requestId, approved, optionId) => {
      const currentSessionId = input.get().currentSessionId
      if (!currentSessionId || !requestId) return
      const previousPendingPermissions = input.get().pendingPermissions
      input.set((state) => {
        const interactionState = convergeInteractionState({
          eventBuffer: state.eventBuffer,
          pendingPermissions: state.pendingPermissions.filter((item) => (item.requestId || item.id) !== requestId),
          pendingQuestions: state.pendingQuestions,
          respondingPermissionIds: new Set(state.respondingPermissionIds).add(requestId),
          respondingQuestionIds: state.respondingQuestionIds,
        })

        return {
          ...finalizeConversationView({
            conversationState: state.conversationState,
            conversationBlocks: state.conversationBlocks,
            conversationVersion: state.conversationVersion,
            isRunning: state.isRunning,
            eventBuffer: state.eventBuffer,
            pendingPermissions: interactionState.pendingPermissions,
            pendingQuestions: interactionState.pendingQuestions,
            respondingPermissionIds: interactionState.respondingPermissionIds,
            respondingQuestionIds: interactionState.respondingQuestionIds,
          }),
          respondingPermissionIds: interactionState.respondingPermissionIds,
          pendingPermissions: interactionState.pendingPermissions,
          isSubmitting: false,
          awaitingTurnRestart: false,
          isCancelling: false,
        }
      })
      await input.api.permissionRespond(currentSessionId, requestId, approved, optionId).then(
        () => undefined,
        createRequestFailureHandler(
          input,
          {},
          '权限提交失败',
          () =>
            input.set((state) => {
              const interactionState = convergeInteractionState({
                eventBuffer: state.eventBuffer,
                pendingPermissions: previousPendingPermissions,
                pendingQuestions: state.pendingQuestions,
                respondingPermissionIds: new Set(
                  [...state.respondingPermissionIds].filter((currentRequestId) => currentRequestId !== requestId),
                ),
                respondingQuestionIds: state.respondingQuestionIds,
              })
              return {
                ...finalizeConversationView({
                  conversationState: state.conversationState,
                  conversationBlocks: state.conversationBlocks,
                  conversationVersion: state.conversationVersion,
                  isRunning: state.isRunning,
                  eventBuffer: state.eventBuffer,
                  pendingPermissions: interactionState.pendingPermissions,
                  pendingQuestions: interactionState.pendingQuestions,
                  respondingPermissionIds: interactionState.respondingPermissionIds,
                  respondingQuestionIds: interactionState.respondingQuestionIds,
                }),
                respondingPermissionIds: interactionState.respondingPermissionIds,
                pendingPermissions: interactionState.pendingPermissions,
              }
            }),
        ),
      )
    },

    respondQuestion: async (requestId, action, content) => {
      const currentSessionId = input.get().currentSessionId
      if (!currentSessionId || !requestId) return
      const previousPendingQuestions = input.get().pendingQuestions
      input.set((state) => {
        const interactionState = convergeInteractionState({
          eventBuffer: state.eventBuffer,
          pendingPermissions: state.pendingPermissions,
          pendingQuestions: state.pendingQuestions.filter((item) => (item.requestId || item.id) !== requestId),
          respondingPermissionIds: state.respondingPermissionIds,
          respondingQuestionIds: new Set(state.respondingQuestionIds).add(requestId),
        })

        return {
          ...finalizeConversationView({
            conversationState: state.conversationState,
            conversationBlocks: state.conversationBlocks,
            conversationVersion: state.conversationVersion,
            isRunning: state.isRunning,
            eventBuffer: state.eventBuffer,
            pendingPermissions: interactionState.pendingPermissions,
            pendingQuestions: interactionState.pendingQuestions,
            respondingPermissionIds: interactionState.respondingPermissionIds,
            respondingQuestionIds: interactionState.respondingQuestionIds,
          }),
          respondingQuestionIds: interactionState.respondingQuestionIds,
          pendingQuestions: interactionState.pendingQuestions,
          isSubmitting: false,
          awaitingTurnRestart: false,
          isCancelling: false,
        }
      })
      await input.api.questionRespond(currentSessionId, requestId, action, content).then(
        () => undefined,
        createRequestFailureHandler(
          input,
          {},
          '问题提交失败',
          () =>
            input.set((state) => {
              const interactionState = convergeInteractionState({
                eventBuffer: state.eventBuffer,
                pendingPermissions: state.pendingPermissions,
                pendingQuestions: previousPendingQuestions,
                respondingPermissionIds: state.respondingPermissionIds,
                respondingQuestionIds: new Set(
                  [...state.respondingQuestionIds].filter((currentRequestId) => currentRequestId !== requestId),
                ),
              })
              return {
                ...finalizeConversationView({
                  conversationState: state.conversationState,
                  conversationBlocks: state.conversationBlocks,
                  conversationVersion: state.conversationVersion,
                  isRunning: state.isRunning,
                  eventBuffer: state.eventBuffer,
                  pendingPermissions: interactionState.pendingPermissions,
                  pendingQuestions: interactionState.pendingQuestions,
                  respondingPermissionIds: interactionState.respondingPermissionIds,
                  respondingQuestionIds: interactionState.respondingQuestionIds,
                }),
                respondingQuestionIds: interactionState.respondingQuestionIds,
                pendingQuestions: interactionState.pendingQuestions,
              }
            }),
        ),
      )
    },
  }
}

async function buildPromptParts(text, attachments, businessSessionId, set) {
  const parts = [{ type: 'text', text: text.trim() }]
  const attachmentFeedback = []

  if (attachments?.length) {
    for (const file of attachments) {
      if (file.type?.startsWith('image/')) {
        parts.push({ type: 'image', data: await fileToBase64(file), mimeType: file.type })
      } else if (file.type?.startsWith('audio/')) {
        parts.push({ type: 'audio', data: await fileToBase64(file), mimeType: file.type })
      } else {
        parts.push({
          type: 'resource',
          resource: {
            uri: `file://${file.name}`,
            text: await file.text(),
            mimeType: file.type || 'text/plain',
          },
        })
      }

      // 中文/English: inject a local status event so the attachment shows immediate UI feedback.
      attachmentFeedback.push(createLocalEvent(businessSessionId, 'status_local', { message: `已附加文件：${file.name}` }))
    }
  }

  if (attachmentFeedback.length) {
    set((state) => {
      attachmentFeedback.forEach((event) => {
        if (event.eventId) state.seenEventIds.add(event.eventId)
        state.eventBuffer.push(event)
        appendConversationEvent(state.conversationState, event, false)
      })
      const interactionState = convergeInteractionState({
        eventBuffer: state.eventBuffer,
        pendingPermissions: state.pendingPermissions,
        pendingQuestions: state.pendingQuestions,
        respondingPermissionIds: state.respondingPermissionIds,
        respondingQuestionIds: state.respondingQuestionIds,
      })
      return {
        eventBuffer: state.eventBuffer,
        eventBufferVersion: state.eventBufferVersion + attachmentFeedback.length,
        seenEventIds: state.seenEventIds,
        conversationState: state.conversationState,
        ...finalizeConversationView({
          conversationState: state.conversationState,
          conversationBlocks: state.conversationBlocks,
          conversationVersion: state.conversationVersion,
          isRunning: state.isRunning,
          eventBuffer: state.eventBuffer,
          pendingPermissions: interactionState.pendingPermissions,
          pendingQuestions: interactionState.pendingQuestions,
          respondingPermissionIds: interactionState.respondingPermissionIds,
          respondingQuestionIds: interactionState.respondingQuestionIds,
        }),
      }
    })
  }

  return parts
}
