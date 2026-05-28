import { useMemo } from 'react'
import { useStore, buildCapabilitiesFromSession } from '../../store'

export const TABS = [
  { id: 'create', label: '新建' },
  { id: 'settings', label: '设置' },
  { id: 'inspect', label: '检查' },
  { id: 'events', label: '事件' },
]

export const inputClassName =
  'w-full rounded-[10px] border border-[var(--line-strong)] px-3 py-2 bg-black/55 text-sm outline-none focus:border-[rgba(212,160,90,0.28)] focus:shadow-[0_0_0_3px_rgba(212,160,90,0.1)] placeholder:text-[var(--text-muted)]'

export const selectClassName =
  'w-full rounded-[10px] border border-[var(--line-strong)] px-3 py-2 bg-black/55 text-sm outline-none focus:border-[rgba(212,160,90,0.28)] focus:shadow-[0_0_0_3px_rgba(212,160,90,0.1)] appearance-none disabled:opacity-40 disabled:cursor-not-allowed'

export const secondaryButtonClassName =
  'self-start px-3 py-1.5 text-xs font-semibold rounded-[8px] bg-brand/10 text-brand-text border border-[var(--line)] hover:bg-brand/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed'

export function Field({ label, children }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-[var(--text-dim)]">{label}</span>
      {children}
    </label>
  )
}

export function Select({ id, options, value, onChange, emptyLabel = '请先打开会话' }) {
  return (
    <select
      id={id}
      value={value}
      onChange={onChange ? (event) => onChange(event.target.value) : undefined}
      disabled={!Array.isArray(options) || options.length === 0}
      className={selectClassName}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23a69888' d='M6 7.8L2.4 4.2h7.2z'/%3E%3C/svg%3E\")",
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

  return useMemo(() => {
    const detailCapabilities = buildCapabilitiesFromSession(sessionDetail?.session)
    return {
      ...detailCapabilities,
      modeId: capabilities.modeId || detailCapabilities.modeId,
      modelId: capabilities.modelId || detailCapabilities.modelId,
      modes: capabilities.modes?.length ? capabilities.modes : detailCapabilities.modes,
      models: capabilities.models?.length ? capabilities.models : detailCapabilities.models,
      configOptions: capabilities.configOptions?.length ? capabilities.configOptions : detailCapabilities.configOptions,
      availableCommands: capabilities.availableCommands?.length ? capabilities.availableCommands : detailCapabilities.availableCommands,
      usage: capabilities.usage || detailCapabilities.usage,
      sessionInfo: capabilities.sessionInfo || detailCapabilities.sessionInfo,
    }
  }, [capabilities, sessionDetail])
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
      canManageRuntimeSettings: Boolean(
        session?.capabilities?.updateMode && session?.capabilities?.updateModel && session?.capabilities?.updateConfig,
      ),
      canManagePlatformSettings: Boolean(isAdmin),
      // 中文/English: sharing is scoped at workspace level, so the UI should read the
      // capability through workspace wording consistently.
      canShareWorkspace: Boolean(session?.capabilities?.shareWorkspace),
    }
  }, [currentSessionId, sessionDetail, sessions, user, users])
}

export function roleLabel(role) {
  if (role === 'admin') return '管理员'
  if (role === 'developer') return '开发者'
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
