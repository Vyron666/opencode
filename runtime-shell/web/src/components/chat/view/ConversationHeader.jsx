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
    ? 'text-[var(--text-muted)] border-[var(--line)] bg-black/20'
    : isConnected
      ? 'text-[#5a9e7c] border-[#5a9e7c]/20 bg-[#5a9e7c]/10'
      : 'text-brand-text border-brand/20 bg-brand/10'

  return (
    <header className="shrink-0 flex items-start justify-between gap-4 px-5 py-3.5 rounded-[20px] border border-[var(--line)] bg-[var(--surface)] shadow-md backdrop-blur-2xl">
      <div className="min-w-0 flex-1 grid gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-brand shrink-0">Conversation</span>
          <h1 className="text-sm font-bold truncate">{sessionTitle || '未选择会话'}</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="rounded-full border border-[var(--line)] bg-black/20 px-2.5 py-1 text-[11px] font-semibold text-[var(--text-dim)] shrink-0">
            {phase.label}
          </span>
          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium shrink-0 ${connectionTone}`}>
            {connectionLabel}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 pt-0.5">
        {showReconnectAction ? (
          <button
            type="button"
            onClick={() => connectSSE()}
            aria-label="重新连接事件流"
            className="text-xs px-3 py-1.5 rounded-[8px] bg-brand/10 text-brand-text border border-[var(--line)] hover:bg-brand/20 transition-colors focus-visible:ring-2 focus-visible:ring-brand"
          >
            重连
          </button>
        ) : null}
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="打开设置"
          className="text-xs px-3 py-1.5 rounded-[10px] bg-black/20 text-[var(--text-dim)] border border-[var(--line)] hover:bg-black/35 transition-colors focus-visible:ring-2 focus-visible:ring-brand"
        >
          设置
        </button>
      </div>
    </header>
  )
})
