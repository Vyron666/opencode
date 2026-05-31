import {
  buildConversationState,
  finalizeConversationView,
} from '../../components/chat/conversation-blocks'
import {
  buildCapabilitiesFromSession,
  deriveCapPatch,
  mergeCapabilities,
} from '../capabilities'
import { deriveRuntimeFlagsFromEvents } from '../runtime-phase'
import { isLatestSessionSelection } from './session-activation-support'
import {
  writeCurrentSessionIdToLocation,
  writeStoredCurrentSessionId,
} from '../session-selection-support'
import {
  convergeInteractionState,
  mergeSessionEvents,
} from '../session-events'

export async function loadCurrentSessionDetail(input) {
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
    writeCurrentSessionIdToLocation('', 'replace')
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
  const currentState = input.get()
  const session = data.session || null
  const eventBuffer = mergeSessionEvents(
    currentState.currentSessionId === currentSessionId ? currentState.eventBuffer : [],
    Array.isArray(data.events) ? data.events : [],
  )
  const conversationState = buildConversationState(eventBuffer, false)
  const seenEventIds = new Set(
    eventBuffer
      .map((event) => event?.eventId)
      .filter((eventId) => typeof eventId === 'string'),
  )
  const runtimeFlags = deriveRuntimeFlagsFromEvents(eventBuffer)
  const interactionState = convergeInteractionState({
    eventBuffer,
    pendingPermissions: currentState.currentSessionId === currentSessionId ? currentState.pendingPermissions : [],
    pendingQuestions: currentState.currentSessionId === currentSessionId ? currentState.pendingQuestions : [],
    nextPendingPermissions: session?.pendingPermissions ?? [],
    nextPendingQuestions: session?.pendingQuestions ?? [],
    respondingPermissionIds: currentState.currentSessionId === currentSessionId ? currentState.respondingPermissionIds : new Set(),
    respondingQuestionIds: currentState.currentSessionId === currentSessionId ? currentState.respondingQuestionIds : new Set(),
  })
  const pendingPermissions = interactionState.pendingPermissions
  const pendingQuestions = interactionState.pendingQuestions
  const respondingPermissionIds = interactionState.respondingPermissionIds
  const respondingQuestionIds = interactionState.respondingQuestionIds
  const eventCapabilities = eventBuffer.reduce((capabilities, event) => {
    const patch = deriveCapPatch(event)
    return patch ? mergeCapabilities(capabilities, patch) : capabilities
  }, buildCapabilitiesFromSession(session))
  const nextSessionDetail = {
    ...data,
    session: session
      ? {
          ...session,
          pendingPermissions,
          pendingQuestions,
        }
      : session,
    events: eventBuffer,
  }

  input.set({
    sessionDetail: nextSessionDetail,
    eventBuffer,
    eventBufferVersion: eventBuffer.length,
    seenEventIds,
    conversationState,
    ...finalizeConversationView({
      conversationState,
      isRunning: runtimeFlags.isRunning,
      eventBuffer,
      pendingPermissions,
      pendingQuestions,
      respondingPermissionIds,
      respondingQuestionIds,
    }),
    // 中文/English: a reloaded session detail is the source of truth; once the
    // persisted event history has been replayed we must clear any optimistic
    // local sending state even if SSE missed the terminal event live.
    isSubmitting: false,
    isRunning: runtimeFlags.isRunning,
    awaitingTurnRestart: runtimeFlags.awaitingTurnRestart,
    isCancelling: false,
    pendingPermissions,
    pendingQuestions,
    respondingPermissionIds,
    respondingQuestionIds,
    capabilities: eventCapabilities,
  })
  return nextSessionDetail
}
