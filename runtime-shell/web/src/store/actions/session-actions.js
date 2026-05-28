import {
  appendConversationEvent,
  buildConversationState,
  finalizeConversationBlocks,
} from '../../components/chat/conversation-blocks'
import {
  buildCapabilitiesFromSession,
  deriveCapPatch,
  mergeCapabilities,
  parseConfigValue,
} from '../capabilities'
import { createRequestFailureHandler } from './interaction-action-support'
import { deriveRunningStateFromEvents } from '../runtime-phase'

export function createSessionActions(input) {
  return {
    setCurrentSession: (id) => {
      input.get().disconnectSSE()
      writeStoredCurrentSessionId(input.get().user?.id, id)
      input.set((state) =>
        input.resetConversationState({
          currentSessionId: id,
          sessionSelectionVersion: state.sessionSelectionVersion + 1,
        }),
      )
    },

    loadSessions: async () => {
      const data = await input.api.sessionList()
      const currentSessionId = input.get().currentSessionId
      const nextSessions = Array.isArray(data.items) ? data.items : []
      const nextWorkspaces = Array.isArray(data.workspaces) ? data.workspaces : []
      const restoredSessionId = !currentSessionId
        ? readStoredCurrentSessionId(input.get().user?.id, nextSessions)
        : ''
      const hasCurrentSession = currentSessionId
        ? nextSessions.some((session) => session.id === currentSessionId)
        : false

      if (!currentSessionId || hasCurrentSession) {
        if (currentSessionId) {
          writeStoredCurrentSessionId(input.get().user?.id, currentSessionId)
        }
        input.set((state) => ({
          sessions: nextSessions,
          workspaces: nextWorkspaces,
          currentSessionId: restoredSessionId || state.currentSessionId,
          sessionSelectionVersion:
            restoredSessionId && restoredSessionId !== state.currentSessionId
              ? state.sessionSelectionVersion + 1
              : state.sessionSelectionVersion,
        }))
        return nextSessions
      }

      // 中文/English: if the current session is no longer visible after refresh,
      // clear client-side runtime state so the UI does not keep operating on a stale session.
      input.get().disconnectSSE()
      writeStoredCurrentSessionId(input.get().user?.id, '')
      input.set((state) =>
        input.resetConversationState({
          sessions: nextSessions,
          workspaces: nextWorkspaces,
          currentSessionId: '',
          sessionSelectionVersion: state.sessionSelectionVersion + 1,
        }),
      )
      return nextSessions
    },

    loadWorkerOverview: async () => {
      const data = await input.api.workerList()
      input.set({ workers: data.items || [], workerOverview: data.opencode || null })
      return data
    },

    loadSessionDetail: async () => {
      const currentSessionId = input.get().currentSessionId
      const sessionSelectionVersion = input.get().sessionSelectionVersion
      if (!currentSessionId) {
        input.set(input.resetConversationState({ currentSessionId: '' }))
        return
      }

      const data = await input.api.sessionDetail(currentSessionId).catch((error) => {
        if (error?.status !== 403 && error?.status !== 404) throw error
        if (!isLatestSessionSelection(input, currentSessionId, sessionSelectionVersion)) throw error

        // 中文/English: when the current session becomes forbidden or disappears,
        // clear the stale selection immediately so the UI returns to a safe idle state.
        input.get().disconnectSSE()
        writeStoredCurrentSessionId(input.get().user?.id, '')
        input.set((state) =>
          input.resetConversationState({
            sessions: state.sessions.filter((session) => session.id !== currentSessionId),
            workspaces: state.workspaces,
            currentSessionId: '',
            sessionSelectionVersion: state.sessionSelectionVersion + 1,
          }),
        )
        throw error
      })
      if (!isLatestSessionSelection(input, currentSessionId, sessionSelectionVersion)) return
      const session = data.session || null
      const eventBuffer = Array.isArray(data.events) ? data.events : []
      const conversationState = buildConversationState(eventBuffer, false)
      const seenEventIds = new Set(
        eventBuffer
          .map((event) => event?.eventId)
          .filter((eventId) => typeof eventId === 'string'),
      )
      const isRunning = deriveRunningStateFromEvents(eventBuffer)
      const eventCapabilities = eventBuffer.reduce((capabilities, event) => {
        const patch = deriveCapPatch(event)
        return patch ? mergeCapabilities(capabilities, patch) : capabilities
      }, buildCapabilitiesFromSession(session))

      input.set({
        sessionDetail: data,
        eventBuffer,
        eventBufferVersion: eventBuffer.length,
        seenEventIds,
        conversationState,
        conversationBlocks: finalizeConversationBlocks(conversationState, isRunning),
        conversationVersion: conversationState.latestVersion,
        isSubmitting: false,
        isRunning,
        isCancelling: false,
        pendingPermissions: session?.pendingPermissions ?? [],
        pendingQuestions: session?.pendingQuestions ?? [],
        respondingPermissionIds: new Set(),
        respondingQuestionIds: new Set(),
        capabilities: eventCapabilities,
      })
      return data
    },

    createSession: async (title, projectId, workspaceId) => {
      input.set({ pendingSessionAction: 'create' })
      const session = await input.api.createSession({ title, projectId, workspaceId }).then(
        (value) => value,
        createRequestFailureHandler(input, { pendingSessionAction: '' }, '创建会话失败'),
      )
      await input.get().loadSessions().then(
        (value) => value,
        createRequestFailureHandler(input, { pendingSessionAction: '' }, '刷新会话列表失败'),
      )
      input.set((state) =>
        input.resetConversationState({
          currentSessionId: session.id,
          sessionSelectionVersion: state.sessionSelectionVersion + 1,
          // 中文/English: seed the newly created session into view first, then let
          // activateSession own the activate flag so the open flow is not short-circuited.
          pendingSessionAction: '',
          sessionDetail: {
            session,
            events: [],
            shares: [],
          },
          pendingPermissions: session.pendingPermissions ?? [],
          pendingQuestions: session.pendingQuestions ?? [],
          capabilities: buildCapabilitiesFromSession(session),
        }),
      )
      writeStoredCurrentSessionId(input.get().user?.id, session.id)
      await input.get().activateSession().then(
        (value) => value,
        createRequestFailureHandler(input, { pendingSessionAction: '' }, '打开新会话失败'),
      )
    },

    activateSession: async () => {
      const currentSessionId = input.get().currentSessionId
      const sessionSelectionVersion = input.get().sessionSelectionVersion
      if (!currentSessionId) return
      if (input.get().pendingSessionAction === 'activate') return
      input.set({ pendingSessionAction: 'activate' })

      const detail = await input.get().loadSessionDetail().then(
        (value) => value,
        createRequestFailureHandler(input, { pendingSessionAction: '' }, '读取会话详情失败'),
      )
      if (!isLatestSessionSelection(input, currentSessionId, sessionSelectionVersion)) return
      const session = detail?.session
      if (!session) {
        input.set({ pendingSessionAction: '' })
        return
      }

      if (session.status === 'completed') {
        await input.api.loadSession(currentSessionId).then(
          () => undefined,
          createRequestFailureHandler(input, {}, '加载历史失败'),
        )
      } else if (
        !session.binding?.acpSessionId ||
        session.status === 'created' ||
        session.status === 'orphaned' ||
        session.status === 'failed'
      ) {
        await input.api.openSession(currentSessionId).then(
          () => undefined,
          createRequestFailureHandler(input, {}, '打开会话失败'),
        )
      } else {
        await input.api.resumeSession(currentSessionId).then(
          () => undefined,
          createRequestFailureHandler(input, {}, '恢复会话失败'),
        )
      }
      if (!isLatestSessionSelection(input, currentSessionId, sessionSelectionVersion)) return

      await input.get().loadSessionDetail().then(
        (value) => value,
        createRequestFailureHandler(input, { pendingSessionAction: '' }, '刷新会话详情失败'),
      )
      if (!isLatestSessionSelection(input, currentSessionId, sessionSelectionVersion)) return
      input.get().connectSSE()
      input.set({ pendingSessionAction: '' })
    },

    closeSession: async () => {
      const currentSessionId = input.get().currentSessionId
      if (!currentSessionId) return
      input.set({ pendingSessionAction: 'close' })
      await input.api.closeSession(currentSessionId).then(
        () => undefined,
        createRequestFailureHandler(input, { pendingSessionAction: '' }, '关闭会话失败'),
      )
      await input.get().loadSessions().then(
        (value) => value,
        createRequestFailureHandler(input, { pendingSessionAction: '' }, '刷新会话列表失败'),
      )
      input.get().disconnectSSE()
      writeStoredCurrentSessionId(input.get().user?.id, '')
      input.set((state) =>
        input.resetConversationState({
          currentSessionId: '',
          sessionSelectionVersion: state.sessionSelectionVersion + 1,
          pendingSessionAction: '',
        }),
      )
    },

    openSession: async () => {
      const currentSessionId = input.get().currentSessionId
      if (!currentSessionId) return
      const sessionSelectionVersion = input.get().sessionSelectionVersion
      input.set({ pendingSessionAction: 'open' })
      await input.api.openSession(currentSessionId).then(
        () => undefined,
        createRequestFailureHandler(input, { pendingSessionAction: '' }, '打开会话失败'),
      )
      if (!isLatestSessionSelection(input, currentSessionId, sessionSelectionVersion)) return
      await input.get().loadSessionDetail().then(
        (value) => value,
        createRequestFailureHandler(input, { pendingSessionAction: '' }, '刷新会话详情失败'),
      )
      if (!isLatestSessionSelection(input, currentSessionId, sessionSelectionVersion)) return
      input.get().connectSSE()
      if (!isLatestSessionSelection(input, currentSessionId, sessionSelectionVersion)) return
      input.set({ pendingSessionAction: '' })
    },

    loadHistory: async () => {
      const currentSessionId = input.get().currentSessionId
      if (!currentSessionId) return
      const sessionSelectionVersion = input.get().sessionSelectionVersion
      input.set({ pendingSessionAction: 'load' })
      await input.api.loadSession(currentSessionId).then(
        () => undefined,
        createRequestFailureHandler(input, { pendingSessionAction: '' }, '加载历史失败'),
      )
      if (!isLatestSessionSelection(input, currentSessionId, sessionSelectionVersion)) return
      await input.get().loadSessionDetail().then(
        (value) => value,
        createRequestFailureHandler(input, { pendingSessionAction: '' }, '刷新会话详情失败'),
      )
      if (!isLatestSessionSelection(input, currentSessionId, sessionSelectionVersion)) return
      input.get().connectSSE()
      if (!isLatestSessionSelection(input, currentSessionId, sessionSelectionVersion)) return
      input.set({ pendingSessionAction: '' })
    },

    resumeSession: async () => {
      const currentSessionId = input.get().currentSessionId
      if (!currentSessionId) return
      const sessionSelectionVersion = input.get().sessionSelectionVersion
      input.set({ pendingSessionAction: 'resume' })
      await input.api.resumeSession(currentSessionId).then(
        () => undefined,
        createRequestFailureHandler(input, { pendingSessionAction: '' }, '恢复会话失败'),
      )
      if (!isLatestSessionSelection(input, currentSessionId, sessionSelectionVersion)) return
      await input.get().loadSessionDetail().then(
        (value) => value,
        createRequestFailureHandler(input, { pendingSessionAction: '' }, '刷新会话详情失败'),
      )
      if (!isLatestSessionSelection(input, currentSessionId, sessionSelectionVersion)) return
      input.get().connectSSE()
      if (!isLatestSessionSelection(input, currentSessionId, sessionSelectionVersion)) return
      input.set({ pendingSessionAction: '' })
    },

    forkSession: async (title) => {
      const currentSessionId = input.get().currentSessionId
      if (!currentSessionId) return
      input.set({ pendingSessionAction: 'fork' })
      const forked = await input.api.forkSession(currentSessionId, title).then(
        (value) => value,
        createRequestFailureHandler(input, { pendingSessionAction: '' }, '创建分支失败'),
      )
      await input.get().loadSessions().then(
        (value) => value,
        createRequestFailureHandler(input, { pendingSessionAction: '' }, '刷新会话列表失败'),
      )
      writeStoredCurrentSessionId(input.get().user?.id, forked.id)
      input.set((state) => ({
        currentSessionId: forked.id,
        sessionSelectionVersion: state.sessionSelectionVersion + 1,
        pendingSessionAction: '',
      }))
    },

    updateMode: async (modeId) => {
      const currentSessionId = input.get().currentSessionId
      if (!currentSessionId || !modeId) return
      const sessionSelectionVersion = input.get().sessionSelectionVersion
      input.set({ pendingSettingsAction: 'mode' })
      await input.api.updateMode(currentSessionId, modeId).then(
        () => undefined,
        createRequestFailureHandler(input, { pendingSettingsAction: '' }, '切换模式失败'),
      )
      if (!isLatestSessionSelection(input, currentSessionId, sessionSelectionVersion)) return
      await input.get().loadSessionDetail().then(
        (value) => value,
        createRequestFailureHandler(input, { pendingSettingsAction: '' }, '刷新会话详情失败'),
      )
      if (!isLatestSessionSelection(input, currentSessionId, sessionSelectionVersion)) return
      input.set({ pendingSettingsAction: '' })
    },

    updateModel: async (modelId) => {
      const currentSessionId = input.get().currentSessionId
      if (!currentSessionId || !modelId) return
      const sessionSelectionVersion = input.get().sessionSelectionVersion
      input.set({ pendingSettingsAction: 'model' })
      await input.api.updateModel(currentSessionId, modelId).then(
        () => undefined,
        createRequestFailureHandler(input, { pendingSettingsAction: '' }, '切换模型失败'),
      )
      if (!isLatestSessionSelection(input, currentSessionId, sessionSelectionVersion)) return
      await input.get().loadSessionDetail().then(
        (value) => value,
        createRequestFailureHandler(input, { pendingSettingsAction: '' }, '刷新会话详情失败'),
      )
      if (!isLatestSessionSelection(input, currentSessionId, sessionSelectionVersion)) return
      input.set({ pendingSettingsAction: '' })
    },

    updateConfig: async (configId, value) => {
      const currentSessionId = input.get().currentSessionId
      if (!currentSessionId || !configId) return
      const sessionSelectionVersion = input.get().sessionSelectionVersion
      input.set({ pendingSettingsAction: 'config' })
      await input.api.updateConfig(currentSessionId, configId, parseConfigValue(value)).then(
        () => undefined,
        createRequestFailureHandler(input, { pendingSettingsAction: '' }, '更新配置失败'),
      )
      if (!isLatestSessionSelection(input, currentSessionId, sessionSelectionVersion)) return
      await input.get().loadSessionDetail().then(
        (value) => value,
        createRequestFailureHandler(input, { pendingSettingsAction: '' }, '刷新会话详情失败'),
      )
      if (!isLatestSessionSelection(input, currentSessionId, sessionSelectionVersion)) return
      input.set({ pendingSettingsAction: '' })
    },

    shareWorkspace: async (targetUserId) => {
      const session = input.get().sessionDetail?.session
      if (!session?.workspaceId || !session?.projectId || !targetUserId) return
      input.set({ pendingShareAction: 'share' })
      await input.api.shareWorkspace(session.workspaceId, session.projectId, targetUserId).then(
        () => undefined,
        createRequestFailureHandler(input, { pendingShareAction: '' }, '共享工作区失败'),
      )
      await input.get().loadSessionDetail().then(
        (value) => value,
        createRequestFailureHandler(input, { pendingShareAction: '' }, '刷新会话详情失败'),
      )
      input.set({ pendingShareAction: '' })
    },

    unshareWorkspace: async (targetUserId) => {
      const session = input.get().sessionDetail?.session
      if (!session?.workspaceId || !session?.projectId || !targetUserId) return
      input.set({ pendingShareAction: 'unshare' })
      await input.api.unshareWorkspace(session.workspaceId, session.projectId, targetUserId).then(
        () => undefined,
        createRequestFailureHandler(input, { pendingShareAction: '' }, '取消共享工作区失败'),
      )
      await input.get().loadSessionDetail().then(
        (value) => value,
        createRequestFailureHandler(input, { pendingShareAction: '' }, '刷新会话详情失败'),
      )
      input.set({ pendingShareAction: '' })
    },
  }
}

function isLatestSessionSelection(input, sessionId, sessionSelectionVersion) {
  const state = input.get()
  return state.currentSessionId === sessionId && state.sessionSelectionVersion === sessionSelectionVersion
}

function readStoredCurrentSessionId(userId, sessions) {
  const storedId = readStoredSessionValue(userId)
  if (!storedId) return ''
  if (sessions.some((session) => session.id === storedId)) return storedId
  writeStoredCurrentSessionId(userId, '')
  return ''
}

function writeStoredCurrentSessionId(userId, sessionId) {
  const storage = getSessionSelectionStorage()
  const key = buildSessionSelectionStorageKey(userId)
  if (!storage || !key) return
  if (!sessionId) {
    storage.removeItem(key)
    return
  }
  storage.setItem(key, sessionId)
}

function readStoredSessionValue(userId) {
  const storage = getSessionSelectionStorage()
  const key = buildSessionSelectionStorageKey(userId)
  if (!storage || !key) return ''
  return storage.getItem(key) || ''
}

function buildSessionSelectionStorageKey(userId) {
  if (!userId) return ''
  return `runtime-shell.current-session.${userId}`
}

function getSessionSelectionStorage() {
  if (typeof window === 'undefined') return null
  return window.localStorage
}
