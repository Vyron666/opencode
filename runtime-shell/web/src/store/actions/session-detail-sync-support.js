import {
  buildConversationState,
  finalizeConversationBlocks,
} from '../../components/chat/conversation-blocks'
import {
  buildCapabilitiesFromSession,
  deriveCapPatch,
  mergeCapabilities,
} from '../capabilities'
import { deriveRunningStateFromEvents } from '../runtime-phase'
import { isLatestSessionSelection } from './session-activation-support'
import {
  writeCurrentSessionIdToLocation,
  writeStoredCurrentSessionId,
} from '../session-selection-support'

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
}
