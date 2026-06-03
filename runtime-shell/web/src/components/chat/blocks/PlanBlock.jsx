import { useState } from 'react'

export function PlanBlock({ block }) {
  const [expanded, setExpanded] = useState(false)
  const entries = Array.isArray(block.entries) ? block.entries : []
  const preview = block.message || entries.map((item) => `- ${item.text}`).join('\n')

  return (
    <div className="flex min-w-0 gap-3 items-start">
      <div className="min-w-0 rounded-[18px] px-4 py-3 border border-[rgba(181,148,116,0.12)] bg-black/30 grid gap-2 max-w-[600px] w-full shadow-[0_10px_28px_rgba(0,0,0,0.1)]">
        <div className="flex items-center gap-2">
          <div className="text-[10px] font-bold text-brand tracking-widest uppercase">Plan</div>
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="ml-auto text-[10px] px-2.5 py-1 rounded-full border border-[rgba(181,148,116,0.18)] bg-black/25 text-[var(--text-muted)] hover:bg-black/35 transition-colors"
          >
            {expanded ? '收起' : '展开'}
          </button>
        </div>
        {block.message && (
          <div className={`text-[13px] text-[var(--text-dim)] leading-relaxed whitespace-pre-wrap break-words ${expanded ? '' : 'line-clamp-4'}`}>
            {preview}
          </div>
        )}
        {entries.length > 0 && (
          <div className="grid gap-2 pt-1">
            {entries.map((entry, index) => (
              <div key={`${entry.text}-${index}`} className="flex items-start gap-2.5 text-[13px] text-[var(--text-dim)]">
                <span className={`w-5 shrink-0 font-bold ${entry.status === 'in_progress' ? 'text-brand' : entry.status === 'completed' ? 'text-success' : 'text-[var(--text-muted)]'}`}>
                  {entry.status === 'completed' ? '[✓]' : entry.status === 'in_progress' ? '[•]' : '[ ]'}
                </span>
                <span className="leading-relaxed break-words">{entry.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
