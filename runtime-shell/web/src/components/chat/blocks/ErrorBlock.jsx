import { useStore } from '../../../store'

export function ErrorBlock({ block }) {
  const currentSessionId = useStore((state) => state.currentSessionId)
  const connectSSE = useStore((state) => state.connectSSE)
  const createQuickSession = useStore((state) => state.createQuickSession)
  const isConnectionError = /连接|断开|worker|SSE/i.test(block.message || '')

  return (
    <div className="flex justify-center px-4">
      <div className="w-full max-w-[540px] rounded-[14px] border border-danger/20 bg-danger/5 px-4 py-3">
        <div className="text-[11px] leading-relaxed text-danger">{block.message}</div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {currentSessionId ? (
            <button
              type="button"
              onClick={() => void connectSSE()}
              className="rounded-[8px] border border-danger/20 bg-danger/15 px-3 py-1.5 text-xs text-danger transition-colors hover:bg-danger/20"
            >
              重新连接
            </button>
          ) : null}

          {!isConnectionError ? (
            <button
              type="button"
              onClick={() => void createQuickSession()}
              className="rounded-[8px] border border-[var(--line)] bg-white px-3 py-1.5 text-xs text-[var(--text-dim)] transition-colors hover:bg-[var(--surface-muted)]"
            >
              新对话
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
