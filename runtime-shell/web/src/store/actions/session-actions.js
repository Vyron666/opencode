import {
  readLocationCurrentSessionId,
  writeCurrentSessionIdToLocation,
  writeStoredCurrentSessionId,
} from '../session-selection-support'
import {
  activateCurrentSession,
  loadCurrentSessionHistory,
  openCurrentSession,
  resumeCurrentSession,
} from './session-activation-support'
import { loadCurrentSessionDetail } from './session-detail-sync-support'
import {
  closeCurrentSessionAndReset,
  createSessionAndActivate,
  forkCurrentSessionAndSelect,
} from './session-lifecycle-write-support'
import { loadSessionSummaries } from './session-list-sync-support'
import {
  shareCurrentWorkspace,
  unshareCurrentWorkspace,
  updateCurrentSessionConfig,
  updateCurrentSessionMode,
  updateCurrentSessionModel,
} from './session-settings-support'

export function createSessionActions(input) {
  return {
    setCurrentSession: (id) => {
      input.get().disconnectSSE()
      const selectedSession = input.get().sessions.find((session) => session.id === id)
      writeStoredCurrentSessionId(input.get().user?.id, id, selectedSession?.title || '')
      writeCurrentSessionIdToLocation(id, 'push')
      input.set((state) =>
        input.resetConversationState({
          currentSessionId: id,
          sessionSelectionVersion: state.sessionSelectionVersion + 1,
        }),
      )
    },

    syncCurrentSessionFromLocation: () => {
      const currentSessionId = input.get().currentSessionId
      const nextSessionId = readLocationCurrentSessionId(input.get().sessions)
      if (nextSessionId === currentSessionId) return
      input.get().disconnectSSE()
      const selectedSession = input.get().sessions.find((session) => session.id === nextSessionId)
      writeStoredCurrentSessionId(input.get().user?.id, nextSessionId, selectedSession?.title || '')
      input.set((state) =>
        input.resetConversationState({
          currentSessionId: nextSessionId,
          sessionSelectionVersion: state.sessionSelectionVersion + 1,
        }),
      )
    },

    loadSessions: async () => loadSessionSummaries(input),

    loadWorkerOverview: async () => {
      const data = await input.api.workerList()
      input.set({ workers: data.items || [], workerOverview: data.opencode || null })
      return data
    },

    loadSessionDetail: async () => loadCurrentSessionDetail(input),

    createSession: async (title, projectId, workspaceId) => createSessionAndActivate(input, title, projectId, workspaceId),

    activateSession: async () => activateCurrentSession(input),

    closeSession: async () => closeCurrentSessionAndReset(input),

    openSession: async () => openCurrentSession(input),

    loadHistory: async () => loadCurrentSessionHistory(input),

    resumeSession: async () => resumeCurrentSession(input),

    forkSession: async (title) => forkCurrentSessionAndSelect(input, title),

    updateMode: async (modeId) => updateCurrentSessionMode(input, modeId),

    updateModel: async (modelId) => updateCurrentSessionModel(input, modelId),

    updateConfig: async (configId, value) => updateCurrentSessionConfig(input, configId, value),

    shareWorkspace: async (targetUserId) => shareCurrentWorkspace(input, targetUserId),

    unshareWorkspace: async (targetUserId) => unshareCurrentWorkspace(input, targetUserId),
  }
}
