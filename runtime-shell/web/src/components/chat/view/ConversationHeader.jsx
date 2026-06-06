import { memo } from 'react'
import { useStore } from '../../../store'
import { useSessionCapabilities } from '../../sidebar/sidebar-support'
import { useConversationPhase } from './useConversationPhase'

export const ConversationHeader = memo(function ConversationHeader({ currentSessionId, sessionTitle }) {
  const connectSSE = useStore((state) => state.connectSSE)
  const isConnected = useStore((state) => state.isConnected)
  const reconnectAttempt = useStore((state) => state.reconnectAttempt)
  const phase = useConversationPhase()
  const capabilities = useSessionCapabilities()
  const modelLabel =
    capabilities.models?.find((item) => item.id === capabilities.modelId)?.label?.split(' · ').at(-1) ||
    capabilities.modelId?.split('/').at(-1) ||
    'Runtime'

  const subtitle = !currentSessionId
    ? '从左侧选择会话，或新建一个会话继续当前工作台流程'
      : phase.isBusy
        ? phase.detail || '当前会话正在继续推进任务'
        : '保持上下文，继续这项工作'

  const statusLabel = !currentSessionId ? '未连接' : isConnected ? '就绪' : reconnectAttempt > 0 ? `重连 ${reconnectAttempt}` : '连接中'
  const statusClassName = !currentSessionId
    ? 'border-[#dbe5f6] bg-[#f6f8fe] text-[#7c8aa5]'
    : isConnected
      ? 'border-[#cbeadf] bg-[#eef9f4] text-[#0f9f6e]'
      : 'border-[#dbe5f6] bg-[#f6f8fe] text-[#61718d]'

  return (
    <header className="shrink-0 border-b border-[#eef2ff] bg-white px-6 py-5 max-[1024px]:px-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[17px] font-bold text-[#18233b]">{sessionTitle || '新建会话'}</h1>
          <div className="mt-1 text-[12px] text-[#70809c]">{subtitle}</div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden rounded-full border border-[#dbe5f6] bg-[#f6f8fe] px-3 py-1.5 text-[12px] text-[#4a5a73] xl:inline-flex">
            <span className="mr-1.5 inline-block h-2 w-2 self-center rounded-full bg-[#0f9f6e]" />
            {modelLabel}
          </span>

          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${statusClassName}`}>{statusLabel}</span>

          {currentSessionId && !isConnected && reconnectAttempt === 0 ? (
            <button
              type="button"
              onClick={() => connectSSE()}
              className="rounded-full border border-[#dbe5f6] bg-white px-3 py-1.5 text-[12px] font-medium text-[#3566df] transition-colors hover:bg-[#f5f8ff]"
            >
              重新连接
            </button>
          ) : null}
        </div>
      </div>
    </header>
  )
})
