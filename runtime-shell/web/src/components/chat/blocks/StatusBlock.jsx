export function StatusBlock({ block }) {
  return (
    <div className="flex justify-center px-4">
      <div className="w-full max-w-[540px] rounded-[14px] border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-2.5 text-center">
        <div className="text-[11px] text-[var(--text-muted)]">{block.message}</div>
      </div>
    </div>
  )
}
