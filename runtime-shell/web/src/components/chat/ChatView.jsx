import { useState } from 'react'
import { useStore } from '../../store'
import SettingsDrawer from '../sidebar/SettingsDrawer.jsx'
import { ConversationHeader } from './view/ConversationHeader'
import { ConversationPhaseBanner } from './view/ConversationPhaseBanner'
import { ConversationSection } from './view/ConversationSection'
import { ComposerSection } from './view/ComposerSection'

export default function ChatView({ settingsOpen, settingsSection, onOpenSettings, onCloseSettings }) {
  const currentSessionId = useStore((state) => state.currentSessionId)
  const flash = useStore((state) => state.flash)
  const sessionTitle = useStore((state) =>
    state.sessionDetail?.session?.title ||
    state.capabilities.sessionInfo?.title ||
    (state.currentSessionId
      ? state.sessions.find((session) => session.id === state.currentSessionId)?.title || ''
      : ''),
  )
  const [showDebug, setShowDebug] = useState(false)

  return (
    <main className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-white max-[1024px]:h-auto">
      <ConversationHeader
        currentSessionId={currentSessionId}
        sessionTitle={sessionTitle}
        onOpenSettings={onOpenSettings}
      />
      {flash ? (
        <div className="mx-6 mt-4 shrink-0 animate-slide-down rounded-[12px] border border-brand/15 bg-brand/10 px-4 py-3 text-xs text-[var(--text-dim)] max-[1024px]:mx-4">
          {flash}
        </div>
      ) : null}
      <ConversationPhaseBanner currentSessionId={currentSessionId} />
      <ConversationSection currentSessionId={currentSessionId} showDebug={showDebug} />
      <ComposerSection
        currentSessionId={currentSessionId}
        showDebug={showDebug}
        setShowDebug={setShowDebug}
        onOpenSettings={onOpenSettings}
      />
      <SettingsDrawer open={settingsOpen} activeSection={settingsSection} onClose={onCloseSettings} />
    </main>
  )
}
