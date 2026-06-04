export function UserMessageBlock({ block }) {
  const timestampLabel = formatMessageTime(block.timestamp)

  return (
    <div className="group flex min-w-0 items-start justify-end gap-3">
      <div className="relative grid min-w-0 max-w-[88%] justify-items-end gap-2.5">
        <div className="flex items-center justify-end gap-2 text-[11px] text-[var(--text-muted)]">
          <span className="text-xs font-bold tracking-[0.04em] text-accent">You</span>
          <span>{timestampLabel}</span>
        </div>

        <div className="pointer-events-none absolute left-0 top-0 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(block.message || '')}
            className="pointer-events-auto rounded-full border border-[var(--line)] bg-white px-2.5 py-1 text-[11px] text-[var(--text-dim)] transition-colors hover:bg-[var(--surface-muted)]"
            aria-label="复制用户消息"
            title="复制"
          >
            复制
          </button>
        </div>

        <div
          className="min-w-0 max-w-full whitespace-pre-wrap break-words rounded-[22px] border border-brand/20 bg-[linear-gradient(135deg,#eff6ff,#dbeafe)] px-4.5 py-3.5 text-sm leading-relaxed text-[var(--text)] shadow-[0_14px_34px_rgba(37,99,235,0.10)]"
          style={{ borderTopRightRadius: '6px' }}
        >
          {block.message}
        </div>
      </div>

      <div className="grid h-[36px] w-[36px] shrink-0 place-items-center rounded-[14px] border border-accent/15 bg-accent/10 text-xs font-bold text-accent">
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
