import {
  appendConversationEvent,
  buildConversationState,
  finalizeConversationBlocks,
} from '../../components/chat/conversation-blocks'
import {
  buildCapabilitiesFromSession,
  hasSessionCapabilities,
  parseConfigValue,
} from '../capabilities'
import { deriveRunningStateFromEvents } from '../runtime-phase'

export function createSessionActions(input) {
  return {
    setCurrentSession: (id) => {
      input.get().disconnectSSE()
      input.set(input.resetConversationState({ currentSessionId: id }))
    },

    loadSessions: async () => {
      const data = await input.api.sessionList()
      input.set({ sessions: data.items })
      return data.items
    },

    loadSessionDetail: async () => {
      const currentSessionId = input.get().currentSessionId
      if (!currentSessionId) {
        input.set(input.resetConversationState({ currentSessionId: '' }))
        return
      }

      const data = await input.api.sessionDetail(currentSessionId)
      const session = data.session || null
      const eventBuffer = Array.isArray(data.events) ? data.events : []
      const conversationState = buildConversationState(eventBuffer, false)
      const seenEventIds = new Set(
        eventBuffer
          .map((event) => event?.eventId)
          .filter((eventId) => typeof eventId === 'string'),
      )
      const isRunning = deriveRunningStateFromEvents(eventBuffer)

      input.set({
        sessionDetail: data,
        eventBuffer,
        eventBufferVersion: eventBuffer.length,
        seenEventIds,
        conversationState,
        conversationBlocks: finalizeConversationBlocks(conversationState, isRunning),
        isSubmitting: false,
        isRunning,
        isCancelling: false,
        pendingPermissions: session?.pendingPermissions || [],
        pendingQuestions: session?.pendingQuestions || [],
        respondingPermissionIds: new Set(),
        respondingQuestionIds: new Set(),
        capabilities: buildCapabilitiesFromSession(session),
      })
      return data
    },

    createSession: async (title, projectId, workspacePath) => {
      const session = await input.api.createSession({ title, projectId, workspacePath })
      await input.get().loadSessions()
      input.set({ currentSessionId: session.id })
      await input.get().loadSessionDetail()
    },

    activateSession: async () => {
      const currentSessionId = input.get().currentSessionId
      if (!currentSessionId) return

      const detail = await input.get().loadSessionDetail()
      const session = detail?.session
      if (!session) return

      if (hasSessionCapabilities(session)) {
        input.get().connectSSE()
        return
      }

      if (!session.binding?.acpSessionId || session.status === 'created') {
        await input.api.openSession(currentSessionId)
      } else if (session.status === 'completed') {
        await input.api.loadSession(currentSessionId)
      } else {
        await input.api.resumeSession(currentSessionId)
      }

      await input.get().loadSessionDetail()
      input.get().connectSSE()
    },

    closeSession: async () => {
      const currentSessionId = input.get().currentSessionId
      if (!currentSessionId) return
      await input.api.closeSession(currentSessionId)
      await input.get().loadSessions()
      input.get().disconnectSSE()
      input.set(input.resetConversationState({ currentSessionId: '' }))
    },

    openSession: async () => {
      const currentSessionId = input.get().currentSessionId
      if (!currentSessionId) return
      await input.api.openSession(currentSessionId)
      await input.get().loadSessionDetail()
      input.get().connectSSE()
    },

    loadHistory: async () => {
      const currentSessionId = input.get().currentSessionId
      if (!currentSessionId) return
      await input.api.loadSession(currentSessionId)
      await input.get().loadSessionDetail()
      input.get().connectSSE()
    },

    resumeSession: async () => {
      const currentSessionId = input.get().currentSessionId
      if (!currentSessionId) return
      await input.api.resumeSession(currentSessionId)
      await input.get().loadSessionDetail()
      input.get().connectSSE()
    },

    forkSession: async (title) => {
      const currentSessionId = input.get().currentSessionId
      if (!currentSessionId) return
      const forked = await input.api.forkSession(currentSessionId, title)
      await input.get().loadSessions()
      input.set({ currentSessionId: forked.id })
      await input.get().loadSessionDetail()
    },

    updateMode: async (modeId) => {
      const currentSessionId = input.get().currentSessionId
      if (!currentSessionId || !modeId) return
      await input.api.updateMode(currentSessionId, modeId)
      await input.get().loadSessionDetail()
    },

    updateModel: async (modelId) => {
      const currentSessionId = input.get().currentSessionId
      if (!currentSessionId || !modelId) return
      await input.api.updateModel(currentSessionId, modelId)
      await input.get().loadSessionDetail()
    },

    updateConfig: async (configId, value) => {
      const currentSessionId = input.get().currentSessionId
      if (!currentSessionId || !configId) return
      await input.api.updateConfig(currentSessionId, configId, parseConfigValue(value))
      await input.get().loadSessionDetail()
    },
  }
}
