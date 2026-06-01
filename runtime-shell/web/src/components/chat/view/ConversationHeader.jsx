import { memo } from 'react'
import { useStore } from '../../../store'
import { useConversationPhase } from './useConversationPhase'

export const ConversationHeader = memo(function ConversationHeader({ currentSessionId, sessionTitle }) {
  const connectSSE = useStore((state) => state.connectSSE)
  const cancelPrompt = useStore((state) => state.cancelPrompt)
  const phase = useConversationPhase()

  return (
    <header className="shrink-0 flex items-start justify-between gap-4 px-4 py-3 rounded-[20px] border border-[var(--line)] bg-[var(--surface)] shadow-md backdrop-blur-2xl">
      <div className="min-w-0">
        <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-brand">Conversation</span>
        <h1 className="text-base font-bold mt-0.5 truncate">{sessionTitle || '\u672a\u9009\u62e9\u4f1a\u8bdd'}</h1>
        <p className="text-xs text-[var(--text-muted)] mt-1 truncate">
          {currentSessionId ? `\u4f1a\u8bdd ID\uff1a${currentSessionId}` : '\u8bf7\u5148\u5728\u5de6\u4fa7\u9009\u62e9\u4f1a\u8bdd\uff0c\u6216\u5728\u53f3\u4fa7\u521b\u5efa\u4e00\u4e2a\u65b0\u4f1a\u8bdd\u3002'}
        </p>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <span className="rounded-full border border-[var(--line)] bg-black/25 px-2.5 py-1 text-[11px] font-semibold text-[var(--text-dim)]">
            {'\u72b6\u6001\uff1a'}{phase.label}
          </span>
          {currentSessionId ? <span className="text-[11px] text-[var(--text-muted)]">{phase.detail}</span> : null}
        </div>
      </div>
      <div className="flex gap-2 flex-wrap justify-end shrink-0">
        <button
          onClick={() => connectSSE()}
          aria-label={'\u91cd\u65b0\u8fde\u63a5\u4e8b\u4ef6\u6d41'}
          className="text-xs px-3 py-1.5 rounded-[8px] bg-brand/10 text-brand-text border border-[var(--line)] hover:bg-brand/20 transition-colors focus-visible:ring-2 focus-visible:ring-brand"
        >
          {'\u91cd\u65b0\u8fde\u63a5\u4e8b\u4ef6\u6d41'}
        </button>
        <button
          onClick={() => cancelPrompt()}
          disabled={!phase.canCancel || !currentSessionId}
          aria-label={'\u6682\u505c\u5f53\u524d\u751f\u6210'}
          className="text-xs px-3 py-1.5 rounded-[8px] bg-danger/10 text-danger border border-danger/20 hover:bg-danger/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {phase.id === 'cancelling'
            ? '\u53d6\u6d88\u4e2d...'
            : phase.canCancel
              ? '\u6682\u505c\u751f\u6210'
              : phase.id === 'waiting_permission'
                ? '\u7b49\u5f85\u5ba1\u6279\u4e2d'
                : phase.id === 'waiting_question'
                  ? '\u7b49\u5f85\u56de\u7b54\u4e2d'
                  : '\u6682\u505c\u751f\u6210'}
        </button>
      </div>
    </header>
  )
})
