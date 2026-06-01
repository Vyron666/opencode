export function StatusBlock({ block }) {
  return (
    <div className="flex justify-center px-4">
      <div className="rounded-[14px] px-4 py-2.5 border border-[var(--line)] bg-black/30 text-center max-w-[540px] w-full">
        <div className="text-[11px] text-[var(--text-muted)]">{block.message}</div>
      </div>
    </div>
  )
}
