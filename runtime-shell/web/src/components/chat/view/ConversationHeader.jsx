import { memo } from 'react'
import { useStore } from '../../../store'
import { useConversationPhase } from './useConversationPhase'

export const ConversationHeader = memo(function ConversationHeader({ currentSessionId, sessionTitle, onOpenSettings }) {
  const connectSSE = useStore((state) => state.connectSSE)
  const isConnected = useStore((state) => state.isConnected)
  const reconnectAttempt = useStore((state) => state.reconnectAttempt)
  const phase = useConversationPhase()
  const showReconnectAction = Boolean(currentSessionId) && !isConnected && reconnectAttempt === 0

  const connectionLabel = !currentSessionId
    ? '未连接'
    : isConnected
      ? '已连接'
      : reconnectAttempt > 0
        ? `重连中 ${reconnectAttempt}`
        : '连接中'

  const connectionTone = !currentSessionId
    ? 'text-[var(--text-muted)] border-[var(--line)] bg-[var(--surface-muted)]'
    : isConnected
      ? 'text-[#059669] border-[#059669]/20 bg-[#059669]/10'
      : 'text-brand border-brand/20 bg-brand/10'

  return (
    <header className="shrink-0 flex items-start justify-between gap-4 rounded-[28px] border border-[var(--line)] bg-white px-5 py-4 shadow-[0_16px_38px_rgba(15,23,42,0.07)]">
      <div className="min-w-0 flex-1 grid gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-brand">Conversation</span>
          <h1 className="truncate text-sm font-bold text-[var(--text)]">{sessionTitle || '未选择会话'}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="shrink-0 rounded-full border border-[var(--line)] bg-[var(--surface-muted)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-dim)]">
            {phase.label}
          </span>
          <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium ${connectionTone}`}>
            {connectionLabel}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 pt-0.5">
        {showReconnectAction ? (
          <button
            type="button"
            onClick={() => connectSSE()}
            aria-label="重新连接事件流"
            className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-semibold text-brand transition-colors hover:bg-[var(--surface-muted)]"
          >
            重连
          </button>
        ) : null}
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="打开设置"
          className="rounded-[10px] border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-1.5 text-xs font-semibold text-[var(--text-dim)] transition-colors hover:bg-[var(--bg-strong)]"
        >
          设置
        </button>
      </div>
    </header>
  )
})
