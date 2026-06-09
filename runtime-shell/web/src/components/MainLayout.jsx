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
  const [settingsSection, setSettingsSection] = useState('overview')

  useEffect(() => {
    if (currentSessionId) {
      // 中文/English: reselecting the same session should still re-run activation.
      void activateSession()
      return
    }

    disconnectSSE()
  }, [activateSession, currentSessionId, disconnectSSE, sessionSelectionVersion])

  const openSettings = (section = 'overview') => {
    setSettingsSection(section)
    setSettingsOpen(true)
  }

  return (
    <div className="h-dvh w-full overflow-hidden bg-[#eef2f8]">
      <div className="grid h-full min-h-0 w-full grid-cols-[308px_minmax(0,1fr)] overflow-hidden bg-white max-[1024px]:grid-cols-1">
        <LeftSidebar onOpenSettings={openSettings} />
        <ChatView
          settingsOpen={settingsOpen}
          settingsSection={settingsSection}
          onOpenSettings={openSettings}
          onCloseSettings={() => setSettingsOpen(false)}
        />
      </div>
    </div>
  )
}
