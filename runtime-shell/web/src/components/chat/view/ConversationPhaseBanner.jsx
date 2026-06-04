import { memo } from 'react'
import { useConversationPhase } from './useConversationPhase'

export const ConversationPhaseBanner = memo(function ConversationPhaseBanner({ currentSessionId }) {
  const phase = useConversationPhase()
  if (!currentSessionId || !['waiting_question', 'waiting_permission', 'reconnecting'].includes(phase.id)) return null

  return (
    <div className="shrink-0 rounded-[16px] border border-[var(--line)] bg-[linear-gradient(180deg,#ffffff,#f8fbff)] px-4 py-2.5 text-xs text-[var(--text-dim)] shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
      {phase.detail}
    </div>
  )
})
