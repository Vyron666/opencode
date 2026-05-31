import {
  readLocationCurrentSessionId,
  readStoredCurrentSessionId,
  writeCurrentSessionIdToLocation,
  writeStoredCurrentSessionId,
} from '../session-selection-support'

let latestSessionListRequestId = 0

export async function loadSessionSummaries(input) {
  const requestId = ++latestSessionListRequestId
  const data = await input.api.sessionList()
  if (requestId !== latestSessionListRequestId) {
    // 中文/English: ignore slower session-list responses so an older poll
    // cannot roll back a newer create/select/open transition.
    return Array.isArray(data.items) ? data.items : []
  }
  const currentSessionId = input.get().currentSessionId
  const nextSessions = Array.isArray(data.items) ? data.items : []
  const nextWorkspaces = Array.isArray(data.workspaces) ? data.workspaces : []
  const currentSessionSummary = currentSessionId
    ? nextSessions.find((session) => session.id === currentSessionId) || null
    : null
  const previousSessionSummary = currentSessionId
    ? input.get().sessions.find((session) => session.id === currentSessionId) || null
    : null
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
    if (shouldRefreshCurrentSessionDetail(currentSessionId, previousSessionSummary, currentSessionSummary)) {
      void input.get().loadSessionDetail().catch(() => undefined)
    }
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

function shouldRefreshCurrentSessionDetail(currentSessionId, previousSessionSummary, currentSessionSummary) {
  if (!currentSessionId || !currentSessionSummary) return false
  if (!previousSessionSummary) return true
  return (
    // 中文/English: do not reload detail on every eventCount tick. SSE already
    // streams normal answer chunks live, and a poll-time detail replay here can
    // rebuild the same assistant block mid-stream and cause visible flicker.
    previousSessionSummary.status !== currentSessionSummary.status ||
    previousSessionSummary.capabilityState?.modelId !== currentSessionSummary.capabilityState?.modelId ||
    previousSessionSummary.pendingPermissions?.length !== currentSessionSummary.pendingPermissions?.length ||
    previousSessionSummary.pendingQuestions?.length !== currentSessionSummary.pendingQuestions?.length
  )
}
