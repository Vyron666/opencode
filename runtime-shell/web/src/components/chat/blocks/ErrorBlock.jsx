import { useStore } from '../../../store'

export function ErrorBlock({ block }) {
  const currentSessionId = useStore((state) => state.currentSessionId)
  const connectSSE = useStore((state) => state.connectSSE)
  const createQuickSession = useStore((state) => state.createQuickSession)
  const isConnectionError = /连接|断开|worker|SSE/i.test(block.message || '')

  return (
    <div className="flex justify-center px-4">
      <div className="rounded-[14px] px-4 py-3 border border-danger/20 bg-danger/5 max-w-[540px] w-full">
        <div className="text-[11px] text-danger leading-relaxed">{block.message}</div>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          {currentSessionId ? (
            <button
              type="button"
              onClick={() => void connectSSE()}
              className="text-xs px-3 py-1.5 rounded-[8px] bg-danger/15 text-danger border border-danger/20 hover:bg-danger/20 transition-colors"
            >
              重新连接
            </button>
          ) : null}
          {!isConnectionError ? (
            <button
              type="button"
              onClick={() => void createQuickSession()}
              className="text-xs px-3 py-1.5 rounded-[8px] bg-black/20 text-[var(--text-dim)] border border-[var(--line)] hover:bg-black/35 transition-colors"
            >
              新对话
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
