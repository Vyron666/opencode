import { useMemo, useState } from 'react'
import { ToolData } from './ToolData'

export function ToolBlock({ block }) {
  const [expanded, setExpanded] = useState(block.status === 'pending' || block.status === 'failed')
  const hasDetails = Boolean(block.input || block.output || (block.content?.length > 0) || (block.locations?.length > 0))
  const statusMap = {
    completed: { label: '已完成', color: '#0f9f6e', background: '#eef9f4' },
    failed: { label: '失败', color: '#cf4040', background: '#fff3f3' },
    pending: { label: '进行中', color: '#3566df', background: '#eef3ff' },
  }
  const statusMeta = statusMap[block.status] || statusMap.pending

  const summary = useMemo(() => {
    if (block.locations?.length) return `涉及 ${block.locations.length} 个位置`
    if (block.output) return '已返回工具输出'
    if (block.input) return '包含输入参数'
    if (block.content?.length) return `附带 ${block.content.length} 段内容`
    return ''
  }, [block.content, block.input, block.locations, block.output])

  return (
    <div className="grid w-full max-w-[760px] gap-2.5 rounded-[18px] border border-[#dce6f8] bg-[#f7f9fe] px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
      <div className="flex min-w-0 items-center gap-2">
        <span className="inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ color: statusMeta.color, background: statusMeta.background }}>
          {statusMeta.label}
        </span>
        {block.kind ? <span className="truncate text-[11px] text-[#8a96ab]">{block.kind}</span> : null}
        {hasDetails ? (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="ml-auto rounded-full border border-[#dbe5f6] bg-white px-2.5 py-1 text-[11px] text-[#61718d] transition-colors hover:bg-[#f6f8fe]"
          >
            {expanded ? '收起' : '展开'}
          </button>
        ) : null}
      </div>

      <div className="min-w-0 break-words text-[14px] font-semibold text-[#24324a]">{block.title}</div>
      {!expanded && summary ? <div className="truncate text-[12px] text-[#7c8aa5]">{summary}</div> : null}

      {expanded ? (
        <div className="grid max-h-[400px] gap-2.5 overflow-y-auto pr-1">
          {block.locations?.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {block.locations.map((location, index) => (
                <span
                  key={`${location.path}-${index}`}
                  className="rounded-full border border-[#dbe5f6] bg-white px-2.5 py-1 text-[10px] text-[#7c8aa5]"
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
