export function UserMessageBlock({ block }) {
  return (
    <div className="flex min-w-0 gap-3 items-start justify-end">
      <div className="grid min-w-0 gap-2 max-w-[88%] justify-items-end">
        <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)] justify-end">
          <span className="font-bold text-xs text-accent">You</span>
          <span>刚刚</span>
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
