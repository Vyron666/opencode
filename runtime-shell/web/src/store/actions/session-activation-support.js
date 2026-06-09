import { createRequestFailureHandler } from './interaction-action-support'

export async function activateCurrentSession(input) {
  const currentSessionId = input.get().currentSessionId
  const sessionSelectionVersion = input.get().sessionSelectionVersion
  if (!currentSessionId) return
  if (input.get().pendingSessionAction === 'activate') return
  input.set({ pendingSessionAction: 'activate' })

  const session =
    readSelectedSessionSummary(input, currentSessionId) ||
    (await input.get().loadSessionDetail().then(
      (value) => value?.session,
      createSessionSelectionFailureHandler(input, currentSessionId, sessionSelectionVersion, { pendingSessionAction: '' }, '读取会话详情失败'),
    ))
  if (!isLatestSessionSelection(input, currentSessionId, sessionSelectionVersion)) return
  if (!session) {
    input.set({ pendingSessionAction: '' })
    return
  }

  if (session.status === 'completed' && session.binding?.acpSessionId) {
    await input.api.loadSession(currentSessionId).then(
      () => undefined,
      createSessionSelectionFailureHandler(input, currentSessionId, sessionSelectionVersion, { pendingSessionAction: '' }, '加载历史失败'),
    )
  } else if (!session.binding?.acpSessionId || session.status === 'created') {
    await input.api.openSession(currentSessionId).then(
      () => undefined,
      createSessionSelectionFailureHandler(input, currentSessionId, sessionSelectionVersion, { pendingSessionAction: '' }, '打开会话失败'),
    )
  } else {
    await input.api.resumeSession(currentSessionId).then(
      () => undefined,
      createSessionSelectionFailureHandler(input, currentSessionId, sessionSelectionVersion, { pendingSessionAction: '' }, '恢复会话失败'),
    )
  }
  if (!isLatestSessionSelection(input, currentSessionId, sessionSelectionVersion)) return

  await reloadSessionDetailAndReconnect(input, currentSessionId, sessionSelectionVersion, '刷新会话详情失败')
  if (!isLatestSessionSelection(input, currentSessionId, sessionSelectionVersion)) return
  input.set({ pendingSessionAction: '' })
}

export async function openCurrentSession(input) {
  await runSessionOpenFlow(input, {
    action: 'open',
    request: () => input.api.openSession(input.get().currentSessionId),
    requestFailureMessage: '打开会话失败',
  })
}

export async function loadCurrentSessionHistory(input) {
  await runSessionOpenFlow(input, {
    action: 'load',
    request: () => input.api.loadSession(input.get().currentSessionId),
    requestFailureMessage: '加载历史失败',
  })
}

export async function resumeCurrentSession(input) {
  await runSessionOpenFlow(input, {
    action: 'resume',
    request: () => input.api.resumeSession(input.get().currentSessionId),
    requestFailureMessage: '恢复会话失败',
  })
}

export function isLatestSessionSelection(input, sessionId, sessionSelectionVersion) {
  const state = input.get()
  return state.currentSessionId === sessionId && state.sessionSelectionVersion === sessionSelectionVersion
}

export function readSelectedSessionSummary(input, sessionId) {
  const state = input.get()
  if (state.sessionDetail?.session?.id === sessionId) return state.sessionDetail.session
  return state.sessions.find((session) => session.id === sessionId) || null
}

async function runSessionOpenFlow(input, flow) {
  const currentSessionId = input.get().currentSessionId
  if (!currentSessionId) return
  const sessionSelectionVersion = input.get().sessionSelectionVersion
  input.set({ pendingSessionAction: flow.action })
  await flow.request().then(
    () => undefined,
    createSessionSelectionFailureHandler(input, currentSessionId, sessionSelectionVersion, { pendingSessionAction: '' }, flow.requestFailureMessage),
  )
  if (!isLatestSessionSelection(input, currentSessionId, sessionSelectionVersion)) return
  await reloadSessionDetailAndReconnect(input, currentSessionId, sessionSelectionVersion, '刷新会话详情失败')
  if (!isLatestSessionSelection(input, currentSessionId, sessionSelectionVersion)) return
  input.set({ pendingSessionAction: '' })
}

async function reloadSessionDetailAndReconnect(input, sessionId, sessionSelectionVersion, message) {
  await input.get().loadSessionDetail().then(
    (value) => value,
    createSessionSelectionFailureHandler(input, sessionId, sessionSelectionVersion, { pendingSessionAction: '' }, message),
  )
  if (!isLatestSessionSelection(input, sessionId, sessionSelectionVersion)) return
  input.get().connectSSE()
}

function createSessionSelectionFailureHandler(input, sessionId, sessionSelectionVersion, patch, message) {
  return (error) => {
    if (!isLatestSessionSelection(input, sessionId, sessionSelectionVersion)) throw error
    // 中文/English: only the still-selected session may release its own pending state.
    return createRequestFailureHandler(input, patch, message)(error)
  }
}
