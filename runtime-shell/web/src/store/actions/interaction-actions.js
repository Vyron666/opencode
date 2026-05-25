import {
  appendConversationEvent,
  finalizeConversationBlocks,
} from '../../components/chat/conversation-blocks'
import { createRequestFailureHandler } from './interaction-action-support'
import { fileToBase64 } from '../file-parts'
import { createLocalEvent } from '../session-events'

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

      // 中文/English: `accepted: true` only means the request reached runtime-shell.
      // Wait for real upstream events before switching to running.
      input.set({ isSubmitting: true, isRunning: false, isCancelling: false })
      input.get().setFlash(attachments?.length ? `消息已发送，包含 ${attachments.length} 个附件` : '消息已发送')
      return true
    },

    cancelPrompt: async () => {
      const currentSessionId = input.get().currentSessionId
      if (!currentSessionId) return
      input.set({ isCancelling: true })
      await input.api.cancelSessionPrompt(currentSessionId).then(
        () => undefined,
        createRequestFailureHandler(input, { isCancelling: false }, '取消失败'),
      )
      input.set({ isSubmitting: false })
    },

    setPendingPermissions: (items) => input.set({ pendingPermissions: items }),
    setPendingQuestions: (items) => input.set({ pendingQuestions: items }),

    respondPermission: async (requestId, approved, optionId) => {
      const currentSessionId = input.get().currentSessionId
      if (!currentSessionId || !requestId) return
      input.set((state) => ({
        respondingPermissionIds: new Set(state.respondingPermissionIds).add(requestId),
      }))
      await input.api.permissionRespond(currentSessionId, requestId, approved, optionId).then(
        () => undefined,
        createRequestFailureHandler(
          input,
          {},
          '权限提交失败',
          () =>
            input.set((state) => {
              const respondingPermissionIds = new Set(state.respondingPermissionIds)
              respondingPermissionIds.delete(requestId)
              return { respondingPermissionIds }
            }),
        ),
      )
    },

    respondQuestion: async (requestId, action, content) => {
      const currentSessionId = input.get().currentSessionId
      if (!currentSessionId || !requestId) return
      input.set((state) => ({
        respondingQuestionIds: new Set(state.respondingQuestionIds).add(requestId),
      }))
      await input.api.questionRespond(currentSessionId, requestId, action, content).then(
        () => undefined,
        createRequestFailureHandler(
          input,
          {},
          '问题提交失败',
          () =>
            input.set((state) => {
              const respondingQuestionIds = new Set(state.respondingQuestionIds)
              respondingQuestionIds.delete(requestId)
              return { respondingQuestionIds }
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
      return {
        eventBuffer: state.eventBuffer,
        eventBufferVersion: state.eventBufferVersion + attachmentFeedback.length,
        seenEventIds: state.seenEventIds,
        conversationState: state.conversationState,
        conversationBlocks: finalizeConversationBlocks(state.conversationState, state.isRunning),
        conversationVersion: state.conversationState.latestVersion,
      }
    })
  }

  return parts
}
