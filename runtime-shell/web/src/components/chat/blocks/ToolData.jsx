import { formatData } from './format-data'

export function ToolData({ label, value }) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">{label}</span>
      <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-[12px] border border-[var(--line)] bg-[var(--surface-muted)] p-2.5 font-mono text-[11px] text-[var(--text-muted)]">
        {formatData(value)}
      </pre>
    </div>
  )
}
