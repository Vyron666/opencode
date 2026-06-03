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
  }, [currentSessionId, sessionSelectionVersion, activateSession, disconnectSSE])

  return (
    <div className="h-dvh min-h-0 grid p-3.5 gap-3.5 overflow-hidden items-stretch
      grid-cols-[300px_minmax(0,1fr)]
      max-[1279px]:grid-cols-[260px_minmax(0,1fr)]
      max-[1024px]:h-auto max-[1024px]:overflow-y-auto max-[1024px]:grid-cols-[1fr]"
    >
      <LeftSidebar onOpenSettings={() => setSettingsOpen(true)} />
      <ChatView settingsOpen={settingsOpen} onOpenSettings={() => setSettingsOpen(true)} onCloseSettings={() => setSettingsOpen(false)} />
    </div>
  )
}
