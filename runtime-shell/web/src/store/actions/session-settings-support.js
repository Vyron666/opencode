import { parseConfigValue } from '../capabilities'
import { createRequestFailureHandler } from './interaction-action-support'
import { isLatestSessionSelection } from './session-activation-support'

export async function updateCurrentSessionMode(input, modeId) {
  if (!modeId) return
  await runSessionSettingsFlow(input, {
    action: 'mode',
    request: (currentSessionId) => input.api.updateMode(currentSessionId, modeId),
    requestFailureMessage: '切换模式失败',
  })
}

export async function updateCurrentSessionModel(input, modelId) {
  if (!modelId) return
  await runSessionSettingsFlow(input, {
    action: 'model',
    request: (currentSessionId) => input.api.updateModel(currentSessionId, modelId),
    requestFailureMessage: '切换模型失败',
  })
}

export async function updateCurrentSessionConfig(input, configId, value) {
  if (!configId) return
  await runSessionSettingsFlow(input, {
    action: 'config',
    request: (currentSessionId) => input.api.updateConfig(currentSessionId, configId, parseConfigValue(value)),
    requestFailureMessage: '更新配置失败',
  })
}

export async function shareCurrentWorkspace(input, targetUserId) {
  const session = input.get().sessionDetail?.session
  if (!session?.workspaceId || !session?.projectId || !targetUserId) return
  input.set({ pendingShareAction: 'share' })
  await input.api.shareWorkspace(session.workspaceId, session.projectId, targetUserId).then(
    () => undefined,
    createRequestFailureHandler(input, { pendingShareAction: '' }, '共享工作区失败'),
  )
  await input.get().loadSessionDetail().then(
    (value) => value,
    createRequestFailureHandler(input, { pendingShareAction: '' }, '刷新会话详情失败'),
  )
  input.set({ pendingShareAction: '' })
}

export async function unshareCurrentWorkspace(input, targetUserId) {
  const session = input.get().sessionDetail?.session
  if (!session?.workspaceId || !session?.projectId || !targetUserId) return
  input.set({ pendingShareAction: 'unshare' })
  await input.api.unshareWorkspace(session.workspaceId, session.projectId, targetUserId).then(
    () => undefined,
    createRequestFailureHandler(input, { pendingShareAction: '' }, '取消共享工作区失败'),
  )
  await input.get().loadSessionDetail().then(
    (value) => value,
    createRequestFailureHandler(input, { pendingShareAction: '' }, '刷新会话详情失败'),
  )
  input.set({ pendingShareAction: '' })
}

async function runSessionSettingsFlow(input, flow) {
  const currentSessionId = input.get().currentSessionId
  if (!currentSessionId) return
  const sessionSelectionVersion = input.get().sessionSelectionVersion
  input.set({ pendingSettingsAction: flow.action })
  await flow.request(currentSessionId).then(
    () => undefined,
    createSessionSelectionFailureHandler(input, currentSessionId, sessionSelectionVersion, { pendingSettingsAction: '' }, flow.requestFailureMessage),
  )
  if (!isLatestSessionSelection(input, currentSessionId, sessionSelectionVersion)) return
  await input.get().loadSessionDetail().then(
    (value) => value,
    createSessionSelectionFailureHandler(input, currentSessionId, sessionSelectionVersion, { pendingSettingsAction: '' }, '刷新会话详情失败'),
  )
  if (!isLatestSessionSelection(input, currentSessionId, sessionSelectionVersion)) return
  input.set({ pendingSettingsAction: '' })
}

function createSessionSelectionFailureHandler(input, sessionId, sessionSelectionVersion, patch, message) {
  return (error) => {
    if (!isLatestSessionSelection(input, sessionId, sessionSelectionVersion)) throw error
    // 中文/English: stale settings requests must not clear a newer session's pending state.
    return createRequestFailureHandler(input, patch, message)(error)
  }
}
