export function createBaseState(createConversationState, defaultCapabilities) {
  return {
    user: null,
    users: [],
    isAuthenticated: false,
    sessions: [],
    workspaces: [],
    workers: [],
    workerOverview: null,
    currentSessionId: '',
    preferredWorkspaceId: '',
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
    awaitingTurnRestart: false,
    isCancelling: false,
    isConnected: false,
    reconnectAttempt: 0,
    activeSSESessionId: '',
    sessionSelectionVersion: 0,
    pendingSessionAction: '',
    pendingWorkspaceAction: '',
    pendingSettingsAction: '',
    pendingShareAction: '',
  }
}

export function resetConversationState(createConversationState, defaultCapabilities, patch) {
  return {
    currentSessionId: '',
    preferredWorkspaceId: '',
    sessionDetail: null,
    eventBuffer: [],
    eventBufferVersion: 0,
    seenEventIds: new Set(),
    conversationState: createConversationState(),
    conversationBlocks: [],
    conversationVersion: 0,
    isSubmitting: false,
    isRunning: false,
    awaitingTurnRestart: false,
    isCancelling: false,
    pendingPermissions: [],
    pendingQuestions: [],
    respondingPermissionIds: new Set(),
    respondingQuestionIds: new Set(),
    capabilities: defaultCapabilities,
    pendingSessionAction: '',
    pendingWorkspaceAction: '',
    pendingSettingsAction: '',
    pendingShareAction: '',
    ...patch,
  }
}

export function resetSessionState(createConversationState, defaultCapabilities, patch) {
  return {
    ...resetConversationState(createConversationState, defaultCapabilities, {}),
    ...patch,
  }
}
