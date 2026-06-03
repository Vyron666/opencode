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
      <div className="max-w-md rounded-[24px] border border-[rgba(181,148,116,0.12)] bg-[rgba(18,14,11,0.76)] px-6 py-7 grid gap-3 shadow-[0_18px_50px_rgba(0,0,0,0.16)]">
        <div className="text-base font-bold text-[var(--text)]">{currentSessionId ? '\u5f00\u59cb\u65b0\u7684\u5bf9\u8bdd' : '\u8bf7\u9009\u62e9\u4e00\u4e2a\u4f1a\u8bdd'}</div>
        <div className="text-sm text-[var(--text-muted)] leading-relaxed">
          {currentSessionId
            ? '\u53d1\u9001\u4e00\u6761\u6d88\u606f\u540e\uff0c\u8fd9\u91cc\u4f1a\u5b9e\u65f6\u663e\u793a\u4e0a\u6e38 ACP \u7684\u4e8b\u4ef6\u3001\u56de\u590d\u3001\u5de5\u5177\u8c03\u7528\u548c\u4ea4\u4e92\u8bf7\u6c42\u3002'
            : '\u5de6\u4fa7\u9009\u62e9\u5df2\u6709\u4f1a\u8bdd\uff0c\u6216\u5148\u521b\u5efa\u4e00\u4e2a\u65b0\u4f1a\u8bdd\u540e\u518d\u5f00\u59cb\u4ea4\u4e92\u3002'}
        </div>
      </div>
    </div>
  )
}
