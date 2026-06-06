import { memo, useMemo } from 'react'
import { useStore } from '../../../store'
import { buildConversationState, finalizeConversationView } from '../conversation-blocks'
import { ChatBlockItem } from '../chat-blocks'
import { convergeInteractionState } from '../../../store/session-events'

export function ConversationTimeline({ blocks, currentSessionId }) {
  if (blocks.length === 0) return <EmptyConversation currentSessionId={currentSessionId} />

  return (
    <div className="mx-auto grid min-w-0 max-w-[1120px] content-start gap-3.5 pb-6">
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

  return (
    <div className="mx-auto grid min-w-0 max-w-[1120px] content-start gap-3.5 pb-6">
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
    <div className="mx-auto grid min-h-full max-w-[1120px] content-start gap-3.5 pb-6">
      <div className="flex justify-end">
        <div className="max-w-[420px] rounded-[16px] rounded-tr-[8px] bg-[#3566df] px-5 py-3 text-sm text-white shadow-[0_12px_30px_rgba(53,102,223,0.16)]">
          帮我开始一个新任务，或者继续某个历史会话。
        </div>
      </div>

      <div className="rounded-[22px] border border-[#dce6f8] bg-[#f7f9fe] px-6 py-5 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
        <div className="text-[24px] font-bold tracking-[-0.02em] text-[#18233b]">
          {currentSessionId ? '开始新的对话' : 'Runtime Shell 工作台'}
        </div>
        <div className="mt-2 max-w-[760px] text-sm leading-7 text-[#61718d]">
          {currentSessionId
            ? '发送消息后，这里会按消息流展示回复、工具调用、执行计划与交互请求。'
            : '从左侧选择一个历史会话，或先新建会话再开始交互。设置、Skill 与 MCP 能力都可以从底部输入区继续调整。'}
        </div>

        <div className="mt-4 grid gap-3">
          <div className="rounded-[16px] border border-[#dfe7f7] bg-white px-4 py-3 text-[14px] leading-7 text-[#46546d]">
            <div>根据你的指令，我可以先分析仓库、读取本地文件，再输出计划与执行步骤。</div>
            <div>如果任务里需要 Skill 或 MCP，我会在对话里继续调用。</div>
          </div>

          <div className="rounded-[16px] border border-[#dfe7f7] bg-white px-4 py-3 text-[13px] text-[#61718d]">
            💭 深度思考中...
          </div>

          <div className="rounded-[16px] border border-[#dfe7f7] bg-white px-4 py-3 text-[13px] text-[#61718d]">
            🔧 已调用工具 · 读取项目结构
          </div>

          <div className="rounded-[16px] border border-[#dfe7f7] bg-white px-4 py-3 text-[13px] leading-7 text-[#46546d]">
            <div className="font-semibold text-[#24324a]">执行计划</div>
            <div>1. 读取代码结构并确认约束</div>
            <div>2. 给出最小改动方案</div>
            <div>3. 修改代码并做页面验收</div>
          </div>

          <div className="rounded-[16px] border border-[#f1e1b4] bg-[#fff9e9] px-4 py-3 text-[13px] text-[#6a5a2e]">
            🔐 如遇权限或确认步骤，会在这里提示你继续处理。
          </div>
        </div>
      </div>
    </div>
  )
}
