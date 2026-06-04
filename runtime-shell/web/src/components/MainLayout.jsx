import { useEffect, useState } from 'react'
import { useStore } from '../store'
import LeftSidebar from './sidebar/LeftSidebar.jsx'
import ChatView from './chat/ChatView.jsx'

export default function MainLayout() {
  const currentSessionId = useStore((state) => state.currentSessionId)
  const sessionSelectionVersion = useStore((state) => state.sessionSelectionVersion)
  const activateSession = useStore((state) => state.activateSession)
  const disconnectSSE = useStore((state) => state.disconnectSSE)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    if (currentSessionId) {
      // 中文/English: reselecting the same session should still re-run activation.
      // The selection version bumps on explicit reselect/history navigation even when the id is unchanged.
      void activateSession()
      return
    }

    disconnectSSE()
  }, [activateSession, currentSessionId, disconnectSSE, sessionSelectionVersion])

  return (
    <div className="h-dvh overflow-hidden px-6 py-6 max-[1024px]:h-auto max-[1024px]:overflow-y-auto max-[1024px]:px-4 max-[1024px]:py-4">
      <div className="mx-auto grid h-full min-h-0 max-w-[1440px] grid-cols-[320px_minmax(0,1fr)] gap-6 rounded-[32px] border border-white/60 bg-[rgba(255,255,255,0.68)] p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur-xl max-[1279px]:grid-cols-[288px_minmax(0,1fr)] max-[1024px]:grid-cols-[1fr] max-[1024px]:rounded-[24px] max-[1024px]:p-4">
        <LeftSidebar onOpenSettings={() => setSettingsOpen(true)} />
        <ChatView
          settingsOpen={settingsOpen}
          onOpenSettings={() => setSettingsOpen(true)}
          onCloseSettings={() => setSettingsOpen(false)}
        />
      </div>
    </div>
  )
}
