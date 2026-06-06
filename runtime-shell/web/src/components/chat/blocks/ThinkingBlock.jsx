import { useState } from 'react'

export function ThinkingBlock({ block }) {
  const [expanded, setExpanded] = useState(false)
  const preview = block.message.slice(0, 120)

  return (
    <div className="max-w-[760px] overflow-hidden rounded-[18px] border border-[#dce6f8] bg-[#f7f9fe] shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[#f1f5ff]"
      >
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#e8efff] text-[#3566df]">💭</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold tracking-[0.12em] text-[#3566df]">深度思考中...</span>
            <span className="text-[11px] text-[#8a96ab]">{expanded ? '收起过程' : '查看过程'}</span>
          </div>
          <div className="mt-1.5 truncate text-[13px] text-[#61718d]">{preview}</div>
        </div>
        <span className="shrink-0 text-xs font-semibold text-[#61718d]">{expanded ? '收起' : '展开'}</span>
      </button>

      {expanded ? (
        <div className="px-4 pb-4">
          <div className="ml-12 whitespace-pre-wrap break-words rounded-[16px] border border-[#dce6f8] bg-white px-4 py-3.5 text-[13px] leading-7 text-[#46546d]">
            {block.message}
          </div>
        </div>
      ) : null}
    </div>
  )
}
