import { useStore } from '../../store'
import { useViewerContext } from './sidebar-support'

export function WorkerOverviewPanel() {
  const workers = useStore((state) => state.workers)
  const workerOverview = useStore((state) => state.workerOverview)
  const { canViewSystemWorkers } = useViewerContext()
  const readyCount = workerOverview?.ready ?? 0
  const totalCount = workerOverview?.total ?? workers.length ?? 0

  if (!canViewSystemWorkers) return null

  return (
    <div className="grid gap-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--text-dim)]">Worker 概览</span>
        <span className="text-[11px] text-[var(--text-muted)]">
          {readyCount}/{totalCount} ready
        </span>
      </div>

      <div className="grid gap-1.5">
        {workers.map((worker) => (
          <div
            key={worker.id}
            className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--text-dim)]"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-[var(--text)]">{worker.name}</span>
              <span>{worker.status}</span>
            </div>
            <div className="mt-1 text-[var(--text-muted)]">
              {worker.activeSessionCount}/{worker.capacity} sessions
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
