import { memo, useMemo } from 'react'
import { useStore } from '../../../store'
import { buildConversationState, finalizeConversationView } from '../conversation-blocks'
import { ChatBlockItem } from '../chat-blocks'
import { convergeInteractionState } from '../../../store/session-events'

export function ConversationTimeline({ blocks, currentSessionId }) {
  if (blocks.length === 0) return <EmptyConversation currentSessionId={currentSessionId} />

  return (
    <div className="grid min-w-0 content-start gap-5 pb-5">
      {blocks.map((block) => (
        <ConversationBlockRow key={block.key} block={block} />
      ))}
    </div>
  )
}

export function DebugConversationTimeline() {
  const eventBuffer = useStore((state) => state.eventBuffer)
  const eventBufferVersion = useStore((state) => state.eventBufferVersion)
  const isRunning = useStore((state) => state.isRunning)
  const pendingPermissions = useStore((state) => state.pendingPermissions)
  const pendingQuestions = useStore((state) => state.pendingQuestions)
  const respondingPermissionIds = useStore((state) => state.respondingPermissionIds)
  const respondingQuestionIds = useStore((state) => state.respondingQuestionIds)
  const blocks = useMemo(() => {
    const conversationState = buildConversationState(eventBuffer, true)
    const interactionState = convergeInteractionState({
      eventBuffer,
      pendingPermissions,
      pendingQuestions,
      respondingPermissionIds,
      respondingQuestionIds,
    })
    return finalizeConversationView({
      conversationState,
      isRunning,
      eventBuffer,
      pendingPermissions: interactionState.pendingPermissions,
      pendingQuestions: interactionState.pendingQuestions,
      respondingPermissionIds: interactionState.respondingPermissionIds,
      respondingQuestionIds: interactionState.respondingQuestionIds,
    }).conversationBlocks
  }, [
    eventBuffer,
    eventBufferVersion,
    isRunning,
    pendingPermissions,
    pendingQuestions,
    respondingPermissionIds,
    respondingQuestionIds,
  ])

  if (blocks.length === 0) return <EmptyConversation currentSessionId={useStore.getState().currentSessionId} />

  // 中文/English: keep expensive raw-event replay inside debug mode only.
  return (
    <div className="grid min-w-0 content-start gap-5 pb-5">
      {blocks.map((block) => (
        <ConversationBlockRow key={block.key} block={block} />
      ))}
    </div>
  )
}

const ConversationBlockRow = memo(function ConversationBlockRow({ block }) {
  return (
    <div className="min-w-0">
      <ChatBlockItem block={block} />
    </div>
  )
})

function EmptyConversation({ currentSessionId }) {
  return (
    <div className="h-full grid place-items-center px-6 text-center">
      <div className="grid max-w-[560px] gap-4 rounded-[28px] border border-[var(--line)] bg-[linear-gradient(180deg,#ffffff,#f8fbff)] px-7 py-8 shadow-[0_18px_44px_rgba(15,23,42,0.08)]">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-[18px] bg-brand/10 text-lg font-bold text-brand">
          RS
        </div>
        <div className="text-lg font-bold text-[var(--text)]">{currentSessionId ? '开始新的对话' : '请选择一个会话'}</div>
        <div className="text-sm leading-7 text-[var(--text-muted)]">
          {currentSessionId
            ? '发送一条消息后，这里会实时展示上游 ACP 的事件、回复、工具调用和交互请求。'
            : '从左侧选择已有会话，或先新建一个会话后再开始交互。'}
        </div>
      </div>
    </div>
  )
}
