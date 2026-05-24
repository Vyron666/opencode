export const DEFAULT_CAPABILITIES = {
  modeId: '',
  modelId: '',
  modes: [],
  models: [],
  configOptions: [],
  availableCommands: [],
  usage: null,
  sessionInfo: null,
}

export function buildCapabilitiesFromSession(sessionSummary) {
  const capabilityState = sessionSummary?.capabilityState || {}

  return mergeCapabilities(DEFAULT_CAPABILITIES, {
    modeId: capabilityState.modeId || capabilityState.modes?.currentModeId || readConfigCurrentValue(capabilityState.configOptions, 'mode'),
    modelId: capabilityState.modelId || capabilityState.models?.currentModelId || readConfigCurrentValue(capabilityState.configOptions, 'model'),
    modes: normalizeModeOptions(capabilityState.modes),
    models: normalizeModelOptions(capabilityState.models),
    configOptions: normalizeConfigOptions(capabilityState.configOptions),
    availableCommands: Array.isArray(capabilityState.availableCommands) ? capabilityState.availableCommands : [],
    usage: capabilityState.usage || null,
    sessionInfo: capabilityState.sessionInfo || null,
  })
}

export function mergeCapabilities(current, patch) {
  return {
    ...current,
    ...patch,
    modeId: patch?.modeId ?? current.modeId ?? '',
    modelId: patch?.modelId ?? current.modelId ?? '',
    modes: patch?.modes ?? current.modes ?? [],
    models: patch?.models ?? current.models ?? [],
    configOptions: patch?.configOptions ?? current.configOptions ?? [],
    availableCommands: patch?.availableCommands ?? current.availableCommands ?? [],
    usage: patch?.usage ?? current.usage ?? null,
    sessionInfo: patch?.sessionInfo ?? current.sessionInfo ?? null,
  }
}

export function deriveCapPatch(event) {
  const payload = event?.payload
  if (!payload) return null

  switch (event.eventType) {
    case 'available_commands_update':
      return {
        availableCommands: Array.isArray(payload.commands)
          ? payload.commands.map((item) => (typeof item === 'string' ? item : item?.name)).filter(Boolean)
          : [],
      }
    case 'usage_update':
      return { usage: payload }
    case 'current_mode_update':
      return {
        modeId: payload.currentModeId || payload.modeId || '',
        ...(Array.isArray(payload.availableModes) ? { modes: normalizeModeOptions(payload) } : {}),
      }
    case 'config_option_update': {
      const normalized = normalizeConfigOptions(payload.configOptions)
      const modeOption = normalized.find((item) => item.id === 'mode' || item.raw?.category === 'mode')
      const modelOption = normalized.find((item) => item.id === 'model' || item.raw?.category === 'model')

      return {
        modeId: typeof modeOption?.currentValue === 'string' ? modeOption.currentValue : undefined,
        modelId: typeof modelOption?.currentValue === 'string' ? modelOption.currentValue : undefined,
        configOptions: normalized,
      }
    }
    case 'session_info_update':
      return { sessionInfo: payload }
    default:
      return null
  }
}

export function hasSessionCapabilities(sessionSummary) {
  const capabilityState = sessionSummary?.capabilityState
  if (!capabilityState) return false
  if (Array.isArray(capabilityState.configOptions) && capabilityState.configOptions.length > 0) return true
  if (Array.isArray(capabilityState.modes?.availableModes) && capabilityState.modes.availableModes.length > 0) return true
  if (Array.isArray(capabilityState.models?.availableModels) && capabilityState.models.availableModels.length > 0) return true
  return false
}

export function parseConfigValue(value) {
  if (value === 'true') return true
  if (value === 'false') return false
  return value
}

function normalizeModeOptions(modeState) {
  if (!modeState || !Array.isArray(modeState.availableModes)) return []
  return modeState.availableModes.map((item) => ({
    id: item.id || item.modeId || '',
    label: item.name || item.label || item.id || item.modeId || '',
    raw: item,
  }))
}

function normalizeModelOptions(modelState) {
  if (!modelState || !Array.isArray(modelState.availableModels)) return []
  return modelState.availableModels.map((item) => ({
    id: item.id || item.modelId || '',
    label: item.name || item.label || item.modelId || item.id || '',
    raw: item,
  }))
}

function normalizeConfigOptions(configOptions) {
  if (!Array.isArray(configOptions)) return []
  return configOptions.map((item) => ({
    id: item.id || item.configId || '',
    label: item.name || item.label || item.id || item.configId || '',
    type: item.type || 'select',
    description: item.description || '',
    currentValue: item.currentValue,
    options: Array.isArray(item.options)
      ? item.options.map((option) => ({
          id: option.id || option.value || option.name || '',
          label: option.name || option.label || option.value || option.id || '',
          value: option.value ?? option.id ?? option.name ?? '',
        }))
      : [],
    raw: item,
  }))
}

function readConfigCurrentValue(configOptions, configId) {
  if (!Array.isArray(configOptions)) return ''
  const option = configOptions.find((item) => item?.id === configId || item?.configId === configId)
  return typeof option?.currentValue === 'string' ? option.currentValue : ''
}
