export function UserMessageBlock({ block }) {
  const timestampLabel = formatMessageTime(block.timestamp)

  return (
    <div className="group flex min-w-0 justify-end">
      <div className="relative grid min-w-0 max-w-[76%] justify-items-end gap-2.5">
        <div className="flex items-center gap-2 text-[11px] text-[#8a96ab]">
          <span className="rounded-full bg-[#eef4ff] px-2.5 py-1 font-semibold tracking-[0.04em] text-[#3566df]">你</span>
          <span>{timestampLabel}</span>
        </div>

        <div className="pointer-events-none absolute left-0 top-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(block.message || '')}
            className="pointer-events-auto rounded-full border border-[#dbe5f6] bg-white px-2.5 py-1 text-[11px] text-[#61718d] shadow-[0_8px_20px_rgba(15,23,42,0.06)] transition-colors hover:bg-[#f6f8fe]"
            aria-label="复制用户消息"
            title="复制"
          >
            复制
          </button>
        </div>

        <div
          className="min-w-0 max-w-full whitespace-pre-wrap break-words rounded-[22px] border border-[#3566df]/15 bg-[linear-gradient(135deg,#3f6ff0_0%,#3566df_48%,#2f5fd7_100%)] px-5 py-4 text-sm leading-7 text-white shadow-[0_18px_38px_rgba(53,102,223,0.18)]"
          style={{ borderTopRightRadius: '10px' }}
        >
          {block.message}
        </div>
      </div>
    </div>
  )
}

function formatMessageTime(timestamp) {
  if (!timestamp) return '刚刚'
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '刚刚'
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
