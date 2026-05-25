import { useEffect } from 'react'
import { useStore } from '../store'
import LeftSidebar from './sidebar/LeftSidebar.jsx'
import RightSidebar from './sidebar/RightSidebar.jsx'
import ChatView from './chat/ChatView.jsx'

export default function MainLayout() {
  const currentSessionId = useStore((state) => state.currentSessionId)
  const activateSession = useStore((state) => state.activateSession)
  const disconnectSSE = useStore((state) => state.disconnectSSE)

  useEffect(() => {
    if (currentSessionId) {
      void activateSession()
      return
    }

    disconnectSSE()
  }, [currentSessionId, activateSession, disconnectSSE])

  useEffect(
    () => () => {
      // 中文/English: only close the stream on the real component unmount.
      // Avoid per-render cleanup races with session activation in StrictMode.
      disconnectSSE()
    },
    [disconnectSSE],
  )

  return (
    <div className="h-dvh min-h-0 grid p-3.5 gap-3.5 overflow-hidden items-stretch
      grid-cols-[260px_minmax(400px,1fr)_320px]
      xl:grid-cols-[280px_minmax(480px,1fr)_340px]
      max-[1100px]:grid-cols-[230px_minmax(0,1fr)]
      max-[800px]:grid-cols-[1fr]"
    >
      <LeftSidebar />
      <ChatView />
      <RightSidebar />
    </div>
  )
}
