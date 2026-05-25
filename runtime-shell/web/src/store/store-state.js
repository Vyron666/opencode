export function createBaseState(createConversationState, defaultCapabilities) {
  return {
    user: null,
    users: [],
    isAuthenticated: false,
    sessions: [],
    workspaces: [],
    currentSessionId: '',
    sessionDetail: null,
    eventBuffer: [],
    eventBufferVersion: 0,
    seenEventIds: new Set(),
    conversationState: createConversationState(),
    conversationBlocks: [],
    conversationVersion: 0,
    pendingPermissions: [],
    pendingQuestions: [],
    respondingPermissionIds: new Set(),
    respondingQuestionIds: new Set(),
    capabilities: defaultCapabilities,
    flash: '',
    flashTimer: null,
    isSubmitting: false,
    isRunning: false,
    isCancelling: false,
    isConnected: false,
    reconnectAttempt: 0,
    activeSSESessionId: '',
  }
}

export function resetConversationState(createConversationState, defaultCapabilities, patch) {
  return {
    currentSessionId: '',
    sessionDetail: null,
    eventBuffer: [],
    eventBufferVersion: 0,
    seenEventIds: new Set(),
    conversationState: createConversationState(),
    conversationBlocks: [],
    conversationVersion: 0,
    isSubmitting: false,
    isRunning: false,
    isCancelling: false,
    pendingPermissions: [],
    pendingQuestions: [],
    respondingPermissionIds: new Set(),
    respondingQuestionIds: new Set(),
    capabilities: defaultCapabilities,
    ...patch,
  }
}

export function resetSessionState(createConversationState, defaultCapabilities, patch) {
  return {
    ...resetConversationState(createConversationState, defaultCapabilities, {}),
    ...patch,
  }
}
