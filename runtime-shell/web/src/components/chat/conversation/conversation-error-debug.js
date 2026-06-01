export function readSessionErrorText(payload) {
  const error = payload?.error
  if (!error || typeof error !== 'object') return '上游会话返回错误'
  if (error.data && typeof error.data === 'object' && typeof error.data.message === 'string' && error.data.message) {
    return error.data.message
  }
  if (typeof error.message === 'string' && error.message) return error.message
  if (typeof error.name === 'string' && error.name) return error.name
  return JSON.stringify(error, null, 2)
}

export function isDebugEvent(eventType) {
  return ['turn_completed', 'usage_update', 'available_commands_update', 'config_option_update', 'current_mode_update', 'session_info_update', 'upstream_update'].includes(eventType)
}
