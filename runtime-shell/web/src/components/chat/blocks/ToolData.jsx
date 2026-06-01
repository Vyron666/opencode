import { formatData } from './format-data'

export function ToolData({ label, value }) {
  return (
    <div className="grid min-w-0 gap-1">
      <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">{label}</span>
      <pre className="max-w-full text-[11px] text-[var(--text-muted)] whitespace-pre-wrap break-words mt-1 bg-black/30 rounded-[10px] p-2 font-mono overflow-x-auto">
        {formatData(value)}
      </pre>
    </div>
  )
}
