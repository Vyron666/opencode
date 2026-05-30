import { buildCapabilitiesFromSession } from '../capabilities'
import {
  writeCurrentSessionIdToLocation,
  writeStoredCurrentSessionId,
} from '../session-selection-support'
import { createRequestFailureHandler } from './interaction-action-support'

export async function createSessionAndActivate(input, title, projectId, workspaceId) {
  input.set({ pendingSessionAction: 'create' })
  const session = await input.api.createSession({ title, projectId, workspaceId, warmup: true }).then(
    (value) => value,
    createRequestFailureHandler(input, { pendingSessionAction: '' }, '创建会话失败'),
  )
  input.set((state) =>
    input.resetConversationState({
      sessions: upsertSessionSummary(state.sessions, session),
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
  writeStoredCurrentSessionId(input.get().user?.id, session.id, session.title || '')
  writeCurrentSessionIdToLocation(session.id, 'push')
  await input.get().activateSession().then(
    (value) => value,
    createRequestFailureHandler(input, { pendingSessionAction: '' }, '打开新会话失败'),
  )
}

export async function closeCurrentSessionAndReset(input) {
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
  writeCurrentSessionIdToLocation('', 'push')
  input.set((state) =>
    input.resetConversationState({
      currentSessionId: '',
      sessionSelectionVersion: state.sessionSelectionVersion + 1,
      pendingSessionAction: '',
    }),
  )
}

export async function forkCurrentSessionAndSelect(input, title) {
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
  writeStoredCurrentSessionId(input.get().user?.id, forked.id, forked.title || '')
  writeCurrentSessionIdToLocation(forked.id, 'push')
  input.set((state) => ({
    currentSessionId: forked.id,
    sessionSelectionVersion: state.sessionSelectionVersion + 1,
    pendingSessionAction: '',
  }))
}

function upsertSessionSummary(sessions, session) {
  const next = Array.isArray(sessions) ? sessions.filter((item) => item.id !== session.id) : []
  next.unshift(session)
  return next
}
