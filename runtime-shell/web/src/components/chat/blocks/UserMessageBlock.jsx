export function UserMessageBlock({ block }) {
  const timestampLabel = formatMessageTime(block.timestamp)

  return (
    <div className="group flex min-w-0 justify-end">
      <div className="relative grid min-w-0 max-w-[78%] justify-items-end gap-2">
        <div className="flex items-center gap-2 text-[11px] text-[#8a96ab]">
          <span>{timestampLabel}</span>
          <span className="text-xs font-bold tracking-[0.04em] text-[#3566df]">You</span>
        </div>

        <div className="pointer-events-none absolute left-0 top-0 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(block.message || '')}
            className="pointer-events-auto rounded-full border border-[#dbe5f6] bg-white px-2.5 py-1 text-[11px] text-[#61718d] transition-colors hover:bg-[#f6f8fe]"
            aria-label="复制用户消息"
            title="复制"
          >
            复制
          </button>
        </div>

        <div
          className="min-w-0 max-w-full whitespace-pre-wrap break-words rounded-[16px] border border-[#3566df]/10 bg-[#3566df] px-4.5 py-3 text-sm leading-7 text-white shadow-[0_12px_28px_rgba(53,102,223,0.16)]"
          style={{ borderTopRightRadius: '8px' }}
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
