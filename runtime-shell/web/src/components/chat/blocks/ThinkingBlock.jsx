import { useState } from 'react'

export function ThinkingBlock({ block }) {
  const [expanded, setExpanded] = useState(false)
  const preview = block.message.slice(0, 96)

  return (
    <div className="max-w-[88%] rounded-[20px] border border-[rgba(212,160,90,0.16)] bg-[rgba(36,30,24,0.92)] overflow-hidden shadow-[0_10px_28px_rgba(0,0,0,0.12)]">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.02]"
      >
        <div className="w-8 self-stretch rounded-full bg-brand/18 border border-brand/10 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-brand tracking-[0.16em] uppercase">Thinking</span>
            <span className="text-[10px] text-[var(--text-muted)]">{expanded ? '隐藏推理过程' : '显示推理过程'}</span>
          </div>
          <div className="mt-1.5 text-xs text-[var(--text-dim)] truncate">{preview}</div>
        </div>
        <span className="text-xs text-[var(--text-dim)] font-semibold shrink-0">{expanded ? '收起' : '展开'}</span>
      </button>

      {expanded ? (
        <div className="px-4 pb-4">
          <div className="ml-11 rounded-[16px] bg-black/20 border border-[rgba(181,148,116,0.12)] px-4 py-3.5 text-xs text-[var(--text-dim)] leading-relaxed whitespace-pre-wrap break-words">
            {block.message}
          </div>
        </div>
      ) : null}
    </div>
  )
}
