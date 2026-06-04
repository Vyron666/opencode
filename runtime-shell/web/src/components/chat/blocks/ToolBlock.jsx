import { useMemo, useState } from 'react'
import { ToolData } from './ToolData'

export function ToolBlock({ block }) {
  const statusColor = block.status === 'completed' ? '#059669' : block.status === 'failed' ? '#dc2626' : '#2563eb'
  const [expanded, setExpanded] = useState(block.status === 'pending' || block.status === 'failed')
  const hasDetails = Boolean(block.input || block.output || (block.content?.length > 0) || (block.locations?.length > 0))
  const summary = useMemo(() => {
    if (block.locations?.length) return `涉及 ${block.locations.length} 个位置`
    if (block.output) return '已返回工具输出'
    if (block.input) return '包含输入参数'
    if (block.content?.length) return `附带 ${block.content.length} 段内容`
    return ''
  }, [block.content, block.input, block.locations, block.output])

  return (
    <div
      className="grid min-w-0 w-full max-w-[700px] gap-2.5 rounded-[20px] border px-4 py-3.5 shadow-[0_12px_30px_rgba(15,23,42,0.07)]"
      style={{
        background: block.status === 'failed' ? 'rgba(220,38,38,0.05)' : '#ffffff',
        borderColor: block.status === 'failed' ? 'rgba(220,38,38,0.16)' : 'var(--line)',
      }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: statusColor }} />
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest" style={{ color: statusColor }}>
          {block.status}
        </span>
        {block.kind ? <span className="min-w-0 truncate text-[10px] uppercase text-[var(--text-muted)]">{block.kind}</span> : null}
        {hasDetails ? (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="ml-auto rounded-full border border-[var(--line)] bg-[var(--surface-muted)] px-2.5 py-1 text-[10px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-strong)]"
            aria-label={expanded ? '收起工具结果' : '展开工具结果'}
          >
            {expanded ? '收起' : '展开'}
          </button>
        ) : null}
      </div>

      <div className="min-w-0 break-words text-[13px] font-semibold text-[var(--text-dim)] line-clamp-2">{block.title}</div>

      {!expanded && summary ? <div className="truncate text-[11px] text-[var(--text-muted)]">{summary}</div> : null}

      {expanded ? (
        <div className="grid max-h-[400px] gap-2.5 overflow-y-auto pr-1">
          {block.locations?.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {block.locations.map((location, index) => (
                <span
                  key={`${location.path}-${index}`}
                  className="rounded-full border border-[var(--line)] bg-[var(--surface-muted)] px-2.5 py-1 text-[10px] text-[var(--text-muted)]"
                >
                  {location.path}
                  {location.line ? `:${location.line}` : ''}
                </span>
              ))}
            </div>
          ) : null}

          {block.input ? <ToolData label="输入" value={block.input} /> : null}
          {block.output ? <ToolData label="输出" value={block.output} /> : null}
          {block.content?.length > 0 ? <ToolData label="内容" value={block.content} /> : null}
        </div>
      ) : null}
    </div>
  )
}
