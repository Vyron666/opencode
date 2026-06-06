import { useState } from 'react'

export function PlanBlock({ block }) {
  const [expanded, setExpanded] = useState(false)
  const entries = Array.isArray(block.entries) ? block.entries : []
  const preview = block.message || entries.map((item) => `- ${item.text}`).join('\n')

  return (
    <div className="flex min-w-0">
      <div className="grid w-full max-w-[780px] gap-2.5 rounded-[24px] border border-[#dce6f8] bg-[linear-gradient(180deg,#fbfcff_0%,#f5f8ff_100%)] px-5 py-4 shadow-[0_16px_34px_rgba(15,23,42,0.05)]">
        <div className="flex items-center gap-2">
          <div className="rounded-full bg-[#eef4ff] px-2.5 py-1 text-[11px] font-bold tracking-[0.12em] text-[#3566df]">执行计划</div>
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="ml-auto rounded-full border border-[#dbe5f6] bg-white px-2.5 py-1 text-[11px] text-[#61718d] shadow-[0_8px_20px_rgba(15,23,42,0.05)] transition-colors hover:bg-[#f6f8fe]"
          >
            {expanded ? '收起' : '展开'}
          </button>
        </div>

        {block.message ? (
          <div className={`whitespace-pre-wrap break-words text-[13px] leading-7 text-[#46546d] ${expanded ? '' : 'line-clamp-4'}`}>
            {preview}
          </div>
        ) : null}

        {entries.length > 0 ? (
          <div className="grid gap-2 pt-1">
            {entries.map((entry, index) => (
              <div key={`${entry.text}-${index}`} className="flex items-start gap-2.5 text-[13px] text-[#46546d]">
                <span
                  className={`mt-[2px] inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                    entry.status === 'completed'
                      ? 'bg-[#eaf7f1] text-[#0f9f6e]'
                      : entry.status === 'in_progress'
                        ? 'bg-[#eef3ff] text-[#3566df]'
                        : 'bg-white text-[#8a96ab]'
                  }`}
                >
                  {entry.status === 'completed' ? '✓' : entry.status === 'in_progress' ? '•' : ''}
                </span>
                <span className="break-words leading-7">{entry.text}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
