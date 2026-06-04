import { useState } from 'react'

export function PlanBlock({ block }) {
  const [expanded, setExpanded] = useState(false)
  const entries = Array.isArray(block.entries) ? block.entries : []
  const preview = block.message || entries.map((item) => `- ${item.text}`).join('\n')

  return (
    <div className="flex min-w-0 items-start gap-3">
      <div className="grid min-w-0 w-full max-w-[600px] gap-2 rounded-[20px] border border-[var(--line)] bg-white px-4 py-3 shadow-[0_12px_30px_rgba(15,23,42,0.07)]">
        <div className="flex items-center gap-2">
          <div className="text-[10px] font-bold uppercase tracking-widest text-brand">Plan</div>
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="ml-auto rounded-full border border-[var(--line)] bg-[var(--surface-muted)] px-2.5 py-1 text-[10px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-strong)]"
          >
            {expanded ? '收起' : '展开'}
          </button>
        </div>

        {block.message ? (
          <div className={`whitespace-pre-wrap break-words text-[13px] leading-relaxed text-[var(--text-dim)] ${expanded ? '' : 'line-clamp-4'}`}>
            {preview}
          </div>
        ) : null}

        {entries.length > 0 ? (
          <div className="grid gap-2 pt-1">
            {entries.map((entry, index) => (
              <div key={`${entry.text}-${index}`} className="flex items-start gap-2.5 text-[13px] text-[var(--text-dim)]">
                <span
                  className={`w-5 shrink-0 font-bold ${
                    entry.status === 'in_progress'
                      ? 'text-brand'
                      : entry.status === 'completed'
                        ? 'text-success'
                        : 'text-[var(--text-muted)]'
                  }`}
                >
                  {entry.status === 'completed' ? '[✓]' : entry.status === 'in_progress' ? '[•]' : '[ ]'}
                </span>
                <span className="break-words leading-relaxed">{entry.text}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
