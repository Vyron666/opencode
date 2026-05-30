import {
  readLocationCurrentSessionId,
  readStoredCurrentSessionId,
  writeCurrentSessionIdToLocation,
  writeStoredCurrentSessionId,
} from '../session-selection-support'

export async function loadSessionSummaries(input) {
  const data = await input.api.sessionList()
  const currentSessionId = input.get().currentSessionId
  const nextSessions = Array.isArray(data.items) ? data.items : []
  const nextWorkspaces = Array.isArray(data.workspaces) ? data.workspaces : []
  const restoredSessionId = !currentSessionId
    ? readLocationCurrentSessionId(nextSessions) || readStoredCurrentSessionId(input.get().user?.id, nextSessions)
    : ''
  const hasCurrentSession = currentSessionId
    ? nextSessions.some((session) => session.id === currentSessionId)
    : false

  if (!currentSessionId || hasCurrentSession) {
    if (currentSessionId) {
      const selectedSession = nextSessions.find((session) => session.id === currentSessionId)
      writeStoredCurrentSessionId(input.get().user?.id, currentSessionId, selectedSession?.title || '')
      writeCurrentSessionIdToLocation(currentSessionId, 'replace')
    } else if (restoredSessionId) {
      const selectedSession = nextSessions.find((session) => session.id === restoredSessionId)
      writeStoredCurrentSessionId(input.get().user?.id, restoredSessionId, selectedSession?.title || '')
      writeCurrentSessionIdToLocation(restoredSessionId, 'replace')
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
  writeCurrentSessionIdToLocation('', 'replace')
  input.set((state) =>
    input.resetConversationState({
      sessions: nextSessions,
      workspaces: nextWorkspaces,
      currentSessionId: '',
      sessionSelectionVersion: state.sessionSelectionVersion + 1,
    }),
  )
  return nextSessions
}
