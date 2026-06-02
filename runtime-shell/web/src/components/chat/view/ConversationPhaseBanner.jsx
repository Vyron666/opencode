import { memo } from 'react'
import { useConversationPhase } from './useConversationPhase'

export const ConversationPhaseBanner = memo(function ConversationPhaseBanner({ currentSessionId }) {
  const phase = useConversationPhase()
  if (!currentSessionId || !['waiting_question', 'waiting_permission', 'reconnecting'].includes(phase.id)) return null

  return (
    <div className="shrink-0 rounded-[14px] px-3.5 py-2 border border-[var(--line)] bg-black/30 text-xs text-[var(--text-dim)]">
      {phase.detail}
    </div>
  )
})
