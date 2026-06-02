export function UserMessageBlock({ block }) {
  const timestampLabel = formatMessageTime(block.timestamp)

  return (
    <div className="group flex min-w-0 gap-3 items-start justify-end">
      <div className="relative grid min-w-0 gap-2 max-w-[88%] justify-items-end">
        <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)] justify-end">
          <span className="font-bold text-xs text-accent">You</span>
          <span>{timestampLabel}</span>
        </div>
        <div className="pointer-events-none absolute left-0 top-0 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(block.message || '')}
            className="pointer-events-auto rounded-full border border-[var(--line)] bg-black/45 px-2.5 py-1 text-[11px] text-[var(--text-dim)] hover:bg-black/60 transition-colors"
            aria-label="复制用户消息"
            title="复制"
          >
            复制
          </button>
        </div>
        <div
          className="min-w-0 max-w-full rounded-[20px] px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words"
          style={{
            background: 'linear-gradient(135deg, #d4a05a, #c1873e)',
            color: '#14100d',
            borderTopRightRadius: '6px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
          }}
        >
          {block.message}
        </div>
      </div>
      <div
        className="w-[34px] h-[34px] rounded-[14px] grid place-items-center shrink-0 text-xs font-bold"
        style={{ background: 'linear-gradient(135deg, rgba(212,120,92,0.25), rgba(212,120,92,0.1))', color: '#d4785c' }}
      >
        U
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
