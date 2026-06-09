import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api'
import { useStore, buildCapabilitiesFromSession } from '../../store'

export const TABS = [
  { id: 'create', label: '\u65b0\u5efa' },
  { id: 'settings', label: '\u8bbe\u7f6e' },
  { id: 'inspect', label: '\u68c0\u67e5' },
  { id: 'events', label: '\u4e8b\u4ef6' },
]

export const inputClassName =
  'w-full rounded-[12px] border border-[var(--line)] px-3.5 py-2.5 bg-[var(--surface)] text-sm text-[var(--text)] outline-none transition-colors focus:border-[var(--brand)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)] placeholder:text-[var(--text-muted)]'

export const selectClassName =
  'w-full rounded-[12px] border border-[var(--line)] px-3.5 py-2.5 bg-[var(--surface)] text-sm text-[var(--text)] outline-none transition-colors focus:border-[var(--brand)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)] appearance-none disabled:opacity-40 disabled:cursor-not-allowed'

export const secondaryButtonClassName =
  'self-start rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2 text-xs font-semibold text-brand transition-colors hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-40'

let configuredProviderModelsCache = []
let configuredProviderModelsRequest = null
const configuredProviderModelListeners = new Set()

export function Field({ label, children }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[11px] font-semibold tracking-[0.04em] text-[var(--text-dim)]">{label}</span>
      {children}
    </label>
  )
}

export function Select({ id, options, value, onChange, emptyLabel = '\u8bf7\u5148\u6253\u5f00\u4f1a\u8bdd', disabled = false }) {
  return (
    <select
      id={id}
      value={value}
      onChange={onChange ? (event) => onChange(event.target.value) : undefined}
      disabled={disabled || !Array.isArray(options) || options.length === 0}
      className={selectClassName}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2364748b' d='M6 7.8L2.4 4.2h7.2z'/%3E%3C/svg%3E\")",
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 12px center',
        paddingRight: '32px',
      }}
    >
      {Array.isArray(options) && options.length > 0 ? (
        options.map((option) => (
          <option key={option.id || option.value} value={option.id || option.value}>
            {option.label || option.name || option.id || option.value}
          </option>
        ))
      ) : (
        <option value="">{emptyLabel}</option>
      )}
    </select>
  )
}

export function useSessionCapabilities() {
  const capabilities = useStore((state) => state.capabilities)
  const sessionDetail = useStore((state) => state.sessionDetail)
  const configuredProviderModels = useConfiguredProviderModels()

  return useMemo(() => {
    const detailCapabilities = buildCapabilitiesFromSession(sessionDetail?.session)
    const hasFallbackModels = detailCapabilities.models?.length > 0
    const hasFallbackCommands = detailCapabilities.availableCommands?.length > 0
    const fallbackModels = hasFallbackModels ? detailCapabilities.models : configuredProviderModels
    return {
      ...detailCapabilities,
      modeId: capabilities.modeId || detailCapabilities.modeId,
      modelId: capabilities.modelId || detailCapabilities.modelId || fallbackModels[0]?.id || '',
      modes: capabilities.modes?.length ? capabilities.modes : detailCapabilities.modes,
      models:
        capabilities.models?.length && (!hasFallbackModels || capabilities.modelId || capabilities.configOptions?.length)
          ? capabilities.models
          : fallbackModels,
      configOptions: capabilities.configOptions?.length ? capabilities.configOptions : detailCapabilities.configOptions,
      availableCommands:
        capabilities.availableCommands?.length && (!hasFallbackCommands || capabilities.models?.length || capabilities.configOptions?.length)
          ? capabilities.availableCommands
          : detailCapabilities.availableCommands,
      usage: capabilities.usage || detailCapabilities.usage,
      sessionInfo: capabilities.sessionInfo || detailCapabilities.sessionInfo,
    }
  }, [capabilities, configuredProviderModels, sessionDetail])
}

export function useViewerContext() {
  const user = useStore((state) => state.user)
  const sessions = useStore((state) => state.sessions)
  const currentSessionId = useStore((state) => state.currentSessionId)
  const sessionDetail = useStore((state) => state.sessionDetail)
  const users = useStore((state) => state.users)

  return useMemo(() => {
    const fallbackSession = currentSessionId
      ? sessions.find((item) => item.id === currentSessionId) || null
      : null
    const session = sessionDetail?.session || fallbackSession || null
    const shares = Array.isArray(sessionDetail?.shares) ? sessionDetail.shares : []
    const isAdmin = user?.role === 'admin'
    const isOwner = Boolean(user && session && session.createdBy === user.id)
    const isSharedSession = session?.visibility === 'workspace_share'
    const owner = users.find((item) => item.id === session?.createdBy) || null
    const canUpdateMode = Boolean(session?.capabilities?.updateMode)
    const canUpdateModel = Boolean(session?.capabilities?.updateModel)
    const canUpdateConfig = Boolean(session?.capabilities?.updateConfig)

    return {
      user,
      session,
      shares,
      owner,
      isAdmin,
      isOwner,
      isSharedSession,
      hasOutgoingShares: Boolean((isAdmin || isOwner) && shares.length > 0),
      canManageSession: Boolean(session?.capabilities?.close),
      canOpenSession: Boolean(session?.capabilities?.open),
      canLoadSession: Boolean(session?.capabilities?.load),
      canResumeSession: Boolean(session?.capabilities?.resume),
      canUpdateMode,
      canUpdateModel,
      canUpdateConfig,
      canManageRuntimeSettings: canUpdateMode || canUpdateModel || canUpdateConfig,
      canManagePlatformSettings: Boolean(isAdmin),
      canManageProviderSettings: Boolean(isAdmin || user?.role === 'developer'),
      canViewSystemWorkers: Boolean(isAdmin),
      // 中文/English: sharing is scoped at workspace level, so the UI should read the
      // capability through workspace wording consistently.
      canShareWorkspace: Boolean(session?.capabilities?.shareWorkspace),
    }
  }, [currentSessionId, sessionDetail, sessions, user, users])
}

export function roleLabel(role) {
  if (role === 'admin') return '\u7ba1\u7406\u5458'
  if (role === 'developer') return '\u5f00\u53d1\u8005'
  return role || '-'
}

export function stringifyConfigValue(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value == null) return ''
  return String(value)
}

export function formatJson(value) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

export function primeConfiguredProviderModels(items) {
  configuredProviderModelsCache = normalizeConfiguredProviderModels(items)
  configuredProviderModelListeners.forEach((listener) => listener(configuredProviderModelsCache))
  return configuredProviderModelsCache
}

function useConfiguredProviderModels() {
  const [models, setModels] = useState(configuredProviderModelsCache)

  useEffect(() => {
    configuredProviderModelListeners.add(setModels)
    if (configuredProviderModelsCache.length > 0) {
      setModels(configuredProviderModelsCache)
    } else {
      const request =
        configuredProviderModelsRequest ||
        api.providerConfig.get().then(
          (data) => {
            configuredProviderModelsRequest = null
            // 中文/English: chat model fallback may only use saved provider configs
            // plus the platform's directly callable free models, never raw builtin templates.
            return primeConfiguredProviderModels([...(data.items || []), ...(data.freeItems || [])])
          },
          () => {
            configuredProviderModelsRequest = null
            return []
          },
        )
      configuredProviderModelsRequest = request
      void request.then((value) => setModels(value))
    }

    return () => configuredProviderModelListeners.delete(setModels)
  }, [])

  return models
}

function normalizeConfiguredProviderModels(items) {
  if (!Array.isArray(items)) return []
  return items.flatMap((provider) => {
    if (!Array.isArray(provider.models)) return []
    return provider.models
      .map((model) => {
        const id = readConfiguredModelId(provider, model)
        if (!id) return null
        return {
          id,
          label: `${provider.name || provider.providerId} · ${model.name || model.id || id}`,
        }
      })
      .filter(Boolean)
  })
}

function readConfiguredModelId(provider, model) {
  if (typeof model?.id === 'string' && model.id.includes('/')) return model.id
  if (typeof provider?.defaultModel === 'string' && provider.defaultModel.endsWith(`/${model?.id || ''}`)) {
    return provider.defaultModel
  }
  if (typeof provider?.providerId === 'string' && typeof model?.id === 'string' && model.id) {
    return `${provider.providerId}/${model.id}`
  }
  return ''
}
