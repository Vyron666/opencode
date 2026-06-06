import { useState } from 'react'

export function ThinkingBlock({ block }) {
  const [expanded, setExpanded] = useState(false)
  const preview = block.message.slice(0, 120)

  return (
    <div className="max-w-[780px] overflow-hidden rounded-[24px] border border-[#dde7fb] bg-[linear-gradient(180deg,#fbfcff_0%,#f5f8ff_100%)] shadow-[0_16px_34px_rgba(15,23,42,0.05)]">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-[#f2f6ff]"
      >
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-[#eaf0ff] text-[#3566df]">💭</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold tracking-[0.12em] text-[#3566df]">深度思考</span>
            <span className="text-[11px] text-[#8a96ab]">{expanded ? '收起过程' : '查看过程'}</span>
          </div>
          <div className="mt-1.5 truncate text-[13px] text-[#61718d]">{preview}</div>
        </div>
        <span className="shrink-0 text-xs font-semibold text-[#61718d]">{expanded ? '收起' : '展开'}</span>
      </button>

      {expanded ? (
        <div className="px-5 pb-5">
          <div className="ml-[52px] whitespace-pre-wrap break-words rounded-[18px] border border-[#dce6f8] bg-white px-4 py-3.5 text-[13px] leading-7 text-[#46546d] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            {block.message}
          </div>
        </div>
      ) : null}
    </div>
  )
}
