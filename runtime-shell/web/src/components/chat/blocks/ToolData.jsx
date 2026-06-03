import { formatData } from './format-data'

export function ToolData({ label, value }) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">{label}</span>
      <pre className="max-w-full text-[11px] text-[var(--text-muted)] whitespace-pre-wrap break-words bg-[rgba(8,6,5,0.72)] rounded-[12px] border border-[rgba(181,148,116,0.12)] p-2.5 font-mono overflow-x-auto">
        {formatData(value)}
      </pre>
    </div>
  )
}
