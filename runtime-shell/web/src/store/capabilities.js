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
  const configOptions = normalizeConfigOptions(capabilityState.configOptions)
  const modes = normalizeModeOptions(capabilityState.modes, configOptions)
  const models = normalizeModelOptions(capabilityState.models, configOptions)

  return mergeCapabilities(DEFAULT_CAPABILITIES, {
    modeId: readCurrentModeId(capabilityState, configOptions, modes),
    modelId: readCurrentModelId(capabilityState, configOptions, models),
    modes,
    models,
    configOptions,
    availableCommands: Array.isArray(capabilityState.availableCommands) ? capabilityState.availableCommands : [],
    usage: capabilityState.usage || null,
    sessionInfo: capabilityState.sessionInfo || null,
  })
}

export function mergeCapabilities(current, patch) {
  const currentSessionInfo = current?.sessionInfo
  const patchSessionInfo = patch?.sessionInfo
  const sessionInfo = patchSessionInfo === null
    ? null
    : patchSessionInfo
      ? {
          ...(currentSessionInfo || {}),
          ...patchSessionInfo,
        }
      : currentSessionInfo ?? null

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
    sessionInfo,
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
      const modes = normalizeModeOptions(null, normalized)
      const models = normalizeModelOptions(null, normalized)

      return {
        modeId: typeof modeOption?.currentValue === 'string' ? modeOption.currentValue : undefined,
        modelId: typeof modelOption?.currentValue === 'string' ? modelOption.currentValue : undefined,
        ...(modes.length ? { modes } : {}),
        ...(models.length ? { models } : {}),
        configOptions: normalized,
      }
    }
    case 'session_info_update':
      return { sessionInfo: payload }
    default:
      return null
  }
}

export function parseConfigValue(value) {
  if (value === 'true') return true
  if (value === 'false') return false
  return value
}

function normalizeModeOptions(modeState, configOptions = []) {
  if (modeState && Array.isArray(modeState.availableModes)) {
    return modeState.availableModes.map((item) => ({
      id: item.id || item.modeId || '',
      label: item.name || item.label || item.id || item.modeId || '',
      raw: item,
    }))
  }

  const modeOption = Array.isArray(configOptions)
    ? configOptions.find((item) => item.id === 'mode' || item.raw?.category === 'mode')
    : null
  if (!modeOption || !Array.isArray(modeOption.options)) return []
  return modeOption.options.map((item) => ({
    id: item.id || item.modeId || item.value || '',
    label: item.label || item.name || item.value || item.id || '',
    raw: item,
  }))
}

function normalizeModelOptions(modelState, configOptions = []) {
  if (modelState && Array.isArray(modelState.availableModels)) {
    return modelState.availableModels.map((item) => ({
      id: item.id || item.modelId || '',
      label: item.name || item.label || item.modelId || item.id || '',
      raw: item,
    }))
  }

  const modelOption = Array.isArray(configOptions)
    ? configOptions.find((item) => item.id === 'model' || item.raw?.category === 'model')
    : null
  if (!modelOption || !Array.isArray(modelOption.options)) return []
  return modelOption.options.map((item) => ({
    id: item.id || item.modelId || item.value || '',
    label: item.label || item.name || item.value || item.id || '',
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

function readCurrentModeId(capabilityState, configOptions, modes) {
  const configModeId = readConfigCurrentValue(configOptions, 'mode')
  if (configModeId) return configModeId
  if (typeof capabilityState.modes?.currentModeId === 'string') return capabilityState.modes.currentModeId
  if (typeof capabilityState.modeId === 'string' && capabilityState.modeId) return capabilityState.modeId
  return modes[0]?.id || ''
}

function readCurrentModelId(capabilityState, configOptions, models) {
  const configModelId = readConfigCurrentValue(configOptions, 'model')
  if (configModelId) return configModelId
  if (typeof capabilityState.models?.currentModelId === 'string') return capabilityState.models.currentModelId
  if (typeof capabilityState.modelId === 'string' && capabilityState.modelId) return capabilityState.modelId
  return models[0]?.id || ''
}
