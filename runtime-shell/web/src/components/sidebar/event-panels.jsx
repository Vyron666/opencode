import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store'

export function PlanPanel() {
  const eventBuffer = useStore((state) => state.eventBuffer)
  const eventBufferVersion = useStore((state) => state.eventBufferVersion)
  const usage = useStore((state) => state.capabilities.usage)
  const lastPlan = useMemo(
    () => [...eventBuffer].reverse().find((event) => event.eventType === 'plan'),
    [eventBuffer, eventBufferVersion],
  )
  const entries = useMemo(() => readPlanEntries(lastPlan?.payload), [lastPlan])

  return (
    <div className="pb-3 border-b border-[var(--line)]">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-brand">Plan / Usage</span>
          <h3 className="text-sm font-bold mt-0.5">运行摘要</h3>
        </div>
      </div>

      <div className="rounded-[14px] p-3 bg-black/60 border border-[var(--line)] text-xs leading-relaxed text-[var(--text-dim)] min-h-[100px] max-h-[180px] overflow-auto mb-2">
        {entries.length > 0 ? (
          <div className="grid gap-1.5">
            {entries.map((entry, index) => (
              <div key={`${entry.text}-${index}`} className="flex items-start gap-2">
                <span className={`w-5 shrink-0 font-bold ${entry.status === 'in_progress' ? 'text-brand' : entry.status === 'completed' ? 'text-success' : 'text-[var(--text-muted)]'}`}>
                  {entry.status === 'completed' ? '[✓]' : entry.status === 'in_progress' ? '[•]' : '[ ]'}
                </span>
                <span className="break-words">{entry.text}</span>
              </div>
            ))}
          </div>
        ) : (
          <span>暂无 Plan 输出</span>
        )}
      </div>

      <pre className="rounded-[14px] p-3 bg-black/60 border border-[var(--line)] font-mono text-xs leading-relaxed text-[var(--text-dim)] whitespace-pre-wrap break-words overflow-auto min-h-[100px] max-h-[160px]">
        {usage ? JSON.stringify(usage, null, 2) : '暂无 Usage 数据'}
      </pre>
    </div>
  )
}

export function EventStreamPanel() {
  const eventBuffer = useStore((state) => state.eventBuffer)
  const eventBufferVersion = useStore((state) => state.eventBufferVersion)
  const recent = useMemo(() => eventBuffer.slice(-30).reverse(), [eventBuffer, eventBufferVersion])
  const [selectedEventId, setSelectedEventId] = useState('')
  const selectedEvent = useMemo(
    () => recent.find((event) => event.eventId === selectedEventId) || recent[0] || null,
    [recent, selectedEventId],
  )

  useEffect(() => {
    if (!recent.length) {
      setSelectedEventId('')
      return
    }
    if (recent.some((event) => event.eventId === selectedEventId)) return
    setSelectedEventId(recent[0].eventId || '')
  }, [recent, selectedEventId])

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-brand">Events</span>
          <h3 className="text-sm font-bold mt-0.5">事件流（最近 {recent.length} / 共 {eventBuffer.length}）</h3>
        </div>
      </div>

      <div className="grid gap-2">
        <div className="rounded-[14px] border border-[var(--line)] bg-black/35 overflow-hidden">
          <div className="max-h-[180px] overflow-auto divide-y divide-[var(--line)]">
            {recent.length > 0 ? (
              recent.map((event) => (
                <button
                  key={event.eventId}
                  type="button"
                  onClick={() => setSelectedEventId(event.eventId || '')}
                  className={`w-full px-3 py-2 text-left text-xs transition-colors ${
                    selectedEvent?.eventId === event.eventId ? 'bg-brand/10 text-[var(--text)]' : 'hover:bg-white/5 text-[var(--text-dim)]'
                  }`}
                >
                  <div className="font-semibold">{event.eventType}</div>
                  <div className="mt-1 text-[11px] text-[var(--text-muted)] break-all">
                    {event.timestamp} · {event.eventId}
                  </div>
                </button>
              ))
            ) : (
              <div className="px-3 py-2 text-xs text-[var(--text-muted)]">暂无事件</div>
            )}
          </div>
        </div>

        <pre className="rounded-[14px] p-3 bg-black/60 border border-[var(--line)] font-mono text-xs leading-relaxed text-[var(--text-dim)] whitespace-pre-wrap break-words overflow-auto min-h-[180px] max-h-[320px]">
          {selectedEvent ? JSON.stringify(selectedEvent, null, 2) : '暂无事件详情'}
        </pre>
      </div>
    </div>
  )
}

function readPlanEntries(payload) {
  if (!Array.isArray(payload?.entries)) return []
  return payload.entries.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    if (typeof item.content !== 'string' || !item.content) return []
    return [
      {
        status: typeof item.status === 'string' ? item.status : 'pending',
        text: item.content,
      },
    ]
  })
}
