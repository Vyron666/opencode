import { useStore } from '../../../store'

export function ErrorBlock({ block }) {
  const currentSessionId = useStore((state) => state.currentSessionId)
  const connectSSE = useStore((state) => state.connectSSE)
  const createQuickSession = useStore((state) => state.createQuickSession)
  const isConnectionError = /连接|断开|worker|SSE/i.test(block.message || '')

  return (
    <div className="flex justify-center px-4">
      <div className="w-full max-w-[620px] rounded-[16px] border border-[#efc4c4] bg-[#fff3f3] px-4 py-3">
        <div className="text-[12px] leading-6 text-[#cf4040]">{block.message}</div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {currentSessionId ? (
            <button
              type="button"
              onClick={() => void connectSSE()}
              className="rounded-[9px] border border-[#efc4c4] bg-white px-3 py-1.5 text-xs text-[#cf4040] transition-colors hover:bg-[#fff7f7]"
            >
              重新连接
            </button>
          ) : null}

          {!isConnectionError ? (
            <button
              type="button"
              onClick={() => void createQuickSession()}
              className="rounded-[9px] border border-[#dbe5f6] bg-white px-3 py-1.5 text-xs text-[#61718d] transition-colors hover:bg-[#f6f8fe]"
            >
              新对话
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
