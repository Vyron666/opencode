import { useState } from 'react'

export function ThinkingBlock({ block }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="flex min-w-0 gap-3 items-start">
      <div className="w-[34px] h-[34px] rounded-[14px] grid place-items-center shrink-0 text-xs font-bold bg-brand/10 text-brand-text">
        想
      </div>
      <div className="grid min-w-0 gap-1.5 max-w-[88%] w-full">
        <button
          onClick={() => setExpanded(!expanded)}
          className={`flex min-w-0 items-center gap-2.5 w-full px-3.5 py-2 rounded-[14px] border transition-colors text-left ${
            expanded ? 'border-brand bg-brand/10' : 'border-[var(--line)] bg-black/30 hover:border-[var(--line-strong)]'
          }`}
        >
          <span className="text-[10px] font-bold text-brand tracking-widest uppercase">Thinking</span>
          <span className="min-w-0 text-xs text-[var(--text-dim)] truncate flex-1">{block.message.slice(0, 80)}</span>
          <span className="text-xs text-[var(--text-dim)] font-bold">{expanded ? '收起' : '展开'}</span>
        </button>
        {expanded && (
          <div className="min-w-0 animate-fade-in px-3.5 pt-2">
            <div className="min-w-0 border-t border-[var(--line)] pt-3 text-xs text-[var(--text-dim)] leading-relaxed whitespace-pre-wrap break-words">
              {block.message}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
