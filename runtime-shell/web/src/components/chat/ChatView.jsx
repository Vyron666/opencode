import { useState } from 'react'
import { useStore } from '../../store'
import { ConversationHeader } from './view/ConversationHeader'
import { ConversationPhaseBanner } from './view/ConversationPhaseBanner'
import { ConversationSection } from './view/ConversationSection'
import { ComposerSection } from './view/ComposerSection'
export default function ChatView() {
  const currentSessionId = useStore((state) => state.currentSessionId)
  const flash = useStore((state) => state.flash)
  const sessionTitle = useStore((state) =>
    state.sessionDetail?.session?.title ||
    // 中文/English: after reload we may restore the selected session from the list
    // before its full detail finishes loading, so keep the header bound to the
    // selected summary title instead of flashing back to "未选择会话".
    (state.currentSessionId
      ? state.sessions.find((session) => session.id === state.currentSessionId)?.title || ''
      : ''),
  )
  const [showDebug, setShowDebug] = useState(false)

  return (
    <main className="chat-shell min-h-0 h-[calc(100dvh-28px)] flex flex-col gap-2.5 overflow-hidden max-[1100px]:order-3 max-[1100px]:h-auto">
      <ConversationHeader currentSessionId={currentSessionId} sessionTitle={sessionTitle} />
      {flash ? (
        <div className="shrink-0 rounded-[14px] px-3.5 py-2 bg-brand/10 border border-[var(--line)] text-xs text-[var(--text-dim)] animate-slide-down">
          {flash}
        </div>
      ) : null}
      <ConversationPhaseBanner currentSessionId={currentSessionId} />
      <ConversationSection currentSessionId={currentSessionId} showDebug={showDebug} />
      <ComposerSection currentSessionId={currentSessionId} showDebug={showDebug} setShowDebug={setShowDebug} />
    </main>
  )
}
