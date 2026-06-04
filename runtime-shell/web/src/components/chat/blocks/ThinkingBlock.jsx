import { useState } from 'react'

export function ThinkingBlock({ block }) {
  const [expanded, setExpanded] = useState(false)
  const preview = block.message.slice(0, 96)

  return (
    <div className="max-w-[88%] overflow-hidden rounded-[20px] border border-[var(--line)] bg-white shadow-[0_12px_30px_rgba(15,23,42,0.07)]">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[var(--surface-muted)]"
      >
        <div className="w-8 shrink-0 self-stretch rounded-full border border-brand/10 bg-brand/10" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand">Thinking</span>
            <span className="text-[10px] text-[var(--text-muted)]">{expanded ? '隐藏推理过程' : '显示推理过程'}</span>
          </div>
          <div className="mt-1.5 truncate text-xs text-[var(--text-dim)]">{preview}</div>
        </div>
        <span className="shrink-0 text-xs font-semibold text-[var(--text-dim)]">{expanded ? '收起' : '展开'}</span>
      </button>

      {expanded ? (
        <div className="px-4 pb-4">
          <div className="ml-11 whitespace-pre-wrap break-words rounded-[16px] border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3.5 text-xs leading-relaxed text-[var(--text-dim)]">
            {block.message}
          </div>
        </div>
      ) : null}
    </div>
  )
}
