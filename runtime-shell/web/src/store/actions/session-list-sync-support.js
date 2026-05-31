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
  const currentState = input.get()
  const currentSessionId = currentState.currentSessionId
  const nextSessions = Array.isArray(data.items) ? data.items : []
  const nextWorkspaces = Array.isArray(data.workspaces) ? data.workspaces : []
  const currentSessionSummary = currentSessionId
    ? nextSessions.find((session) => session.id === currentSessionId) || null
    : null
  const previousSessionSummary = currentSessionId
    ? currentState.sessions.find((session) => session.id === currentSessionId) || null
    : null
  const restoredSessionId = !currentSessionId
    ? readLocationCurrentSessionId(nextSessions) || readStoredCurrentSessionId(currentState.user?.id, nextSessions)
    : ''
  const hasCurrentSession = currentSessionId
    ? nextSessions.some((session) => session.id === currentSessionId)
    : false

  if (!currentSessionId || hasCurrentSession) {
    if (currentSessionId) {
      const selectedSession = nextSessions.find((session) => session.id === currentSessionId)
      writeStoredCurrentSessionId(currentState.user?.id, currentSessionId, selectedSession?.title || '')
      writeCurrentSessionIdToLocation(currentSessionId, 'replace')
    } else if (restoredSessionId) {
      const selectedSession = nextSessions.find((session) => session.id === restoredSessionId)
      writeStoredCurrentSessionId(currentState.user?.id, restoredSessionId, selectedSession?.title || '')
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
    if (shouldRefreshCurrentSessionDetail(currentState, currentSessionId, previousSessionSummary, currentSessionSummary)) {
      void input.get().loadSessionDetail().catch(() => undefined)
    }
    return nextSessions
  }

  // 中文/English: if the current session is no longer visible after refresh,
  // clear client-side runtime state so the UI does not keep operating on a stale session.
  input.get().disconnectSSE()
  writeStoredCurrentSessionId(currentState.user?.id, '')
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

function shouldRefreshCurrentSessionDetail(currentState, currentSessionId, previousSessionSummary, currentSessionSummary) {
  if (!currentSessionId || !currentSessionSummary) return false
  if (!previousSessionSummary) return true
  if (
    // 中文/English: do not reload detail on every eventCount tick. SSE already
    // streams normal answer chunks live, and a poll-time detail replay here can
    // rebuild the same assistant block mid-stream and cause visible flicker.
    previousSessionSummary.status !== currentSessionSummary.status ||
    previousSessionSummary.capabilityState?.modelId !== currentSessionSummary.capabilityState?.modelId ||
    previousSessionSummary.pendingPermissions?.length !== currentSessionSummary.pendingPermissions?.length ||
    previousSessionSummary.pendingQuestions?.length !== currentSessionSummary.pendingQuestions?.length
  ) {
    return true
  }
  if (readSessionEventCount(currentSessionSummary) === readSessionEventCount(previousSessionSummary)) return false
  return shouldConvergeCurrentSessionDetail(currentState, currentSessionSummary)
}

function shouldConvergeCurrentSessionDetail(currentState, currentSessionSummary) {
  if (readSessionEventCount(currentSessionSummary) <= countPersistedEvents(currentState.eventBuffer)) return false
  const localBusy = readLocalBusyState(currentState)
  const summaryBusy = readSummaryBusyState(currentSessionSummary)
  if (localBusy !== summaryBusy) return true
  // 中文/English: when the selected session is no longer following a healthy live SSE
  // stream, the polled session summary must take over and realign the detail state.
  return !currentState.isConnected || currentState.activeSSESessionId !== currentSessionSummary.id
}

function readSessionEventCount(sessionSummary) {
  return Number.isFinite(sessionSummary?.eventCount) ? sessionSummary.eventCount : 0
}

function countPersistedEvents(eventBuffer) {
  if (!Array.isArray(eventBuffer)) return 0
  return eventBuffer.filter((event) => typeof event?.eventType === 'string' && !event.eventType.endsWith('_local')).length
}

function readLocalBusyState(currentState) {
  return (
    currentState.isSubmitting === true ||
    currentState.isRunning === true ||
    currentState.isCancelling === true ||
    currentState.pendingPermissions?.length > 0 ||
    currentState.pendingQuestions?.length > 0 ||
    currentState.respondingPermissionIds?.size > 0 ||
    currentState.respondingQuestionIds?.size > 0
  )
}

function readSummaryBusyState(sessionSummary) {
  if (!sessionSummary) return false
  if (sessionSummary.pendingPermissions?.length > 0 || sessionSummary.pendingQuestions?.length > 0) return true
  return ['opening', 'waiting_input', 'cancelling'].includes(sessionSummary.status)
}
