import { useState } from 'react'
import { ToolData } from './ToolData'

export function ToolBlock({ block }) {
  const statusColor = block.status === 'completed' ? '#5a9e7c' : block.status === 'failed' ? '#c44a3a' : '#d4a05a'
  const [expanded, setExpanded] = useState(false)
  const openByDefault = block.status === 'pending' || block.status === 'failed'
  const hasDetails = Boolean(block.input || block.output || (block.content?.length > 0) || (block.locations?.length > 0))
  const isOpen = openByDefault || expanded

  return (
    <div className="flex min-w-0 gap-3 items-start">
      <div
        className="min-w-0 rounded-[14px] px-3.5 py-2.5 border border-[var(--line)] grid gap-2 max-w-[640px] w-full"
        style={{ background: block.status === 'failed' ? 'rgba(196,74,58,0.08)' : 'rgba(20,16,13,0.35)' }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: statusColor }} />
          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: statusColor }}>
            {block.status}
          </span>
          {block.kind && <span className="min-w-0 text-[10px] text-[var(--text-muted)] uppercase truncate">{block.kind}</span>}
          {hasDetails && (
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              className="ml-auto text-[10px] px-2 py-1 rounded-full border border-[var(--line)] bg-black/25 text-[var(--text-muted)] hover:bg-black/35 transition-colors"
              aria-label={isOpen ? '收起工具结果' : '展开工具结果'}
            >
              {isOpen ? '收起' : '展开'}
            </button>
          )}
        </div>

        <div className="min-w-0 text-xs font-semibold text-[var(--text-dim)] break-words">{block.title}</div>

        {isOpen && (
          <>
            {block.locations?.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {block.locations.map((location, index) => (
                  <span key={`${location.path}-${index}`} className="text-[10px] px-2 py-1 rounded-full bg-black/30 text-[var(--text-muted)] border border-[var(--line)]">
                    {location.path}
                    {location.line ? `:${location.line}` : ''}
                  </span>
                ))}
              </div>
            )}

            {block.input && <ToolData label="输入" value={block.input} />}
            {block.output && <ToolData label="输出" value={block.output} />}
            {block.content?.length > 0 && <ToolData label="内容" value={block.content} />}
          </>
        )}
      </div>
    </div>
  )
}
