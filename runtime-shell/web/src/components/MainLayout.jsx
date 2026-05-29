import { useEffect } from 'react'
import { useStore } from '../store'
import LeftSidebar from './sidebar/LeftSidebar.jsx'
import RightSidebar from './sidebar/RightSidebar.jsx'
import ChatView from './chat/ChatView.jsx'

export default function MainLayout() {
  const currentSessionId = useStore((state) => state.currentSessionId)
  const sessionSelectionVersion = useStore((state) => state.sessionSelectionVersion)
  const activateSession = useStore((state) => state.activateSession)
  const disconnectSSE = useStore((state) => state.disconnectSSE)

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
      grid-cols-[260px_minmax(400px,1fr)_320px]
      xl:grid-cols-[280px_minmax(480px,1fr)_340px]
      max-[1100px]:h-auto max-[1100px]:overflow-y-auto max-[1100px]:grid-cols-[1fr]"
    >
      <LeftSidebar />
      <ChatView />
      <RightSidebar />
    </div>
  )
}
