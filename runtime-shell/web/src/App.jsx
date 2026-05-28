import { useEffect } from 'react'
import { useStore } from './store'
import LoginScreen from './components/LoginScreen.jsx'
import MainLayout from './components/MainLayout.jsx'

let authBootstrapPromise = null
const SESSION_LIST_REFRESH_INTERVAL_MS = 2000

export default function App() {
  const isAuthenticated = useStore((state) => state.isAuthenticated)
  const checkAuth = useStore((state) => state.checkAuth)
  const loadSessions = useStore((state) => state.loadSessions)
  const setFlash = useStore((state) => state.setFlash)

  useEffect(() => {
    // 中文/English: dedupe the initial auth bootstrap so React StrictMode
    // does not fire duplicate 401 checks in development.
    authBootstrapPromise ??= checkAuth()
      .then((ok) => {
        if (ok) return loadSessions()
        return null
      })
      .catch((error) => {
        setFlash(error instanceof Error ? error.message : String(error))
        return null
      })
      .finally(() => {
        authBootstrapPromise = null
      })
  }, [checkAuth, loadSessions, setFlash])

  useEffect(() => {
    if (!isAuthenticated) return

    let refreshing = false

    const refreshSessions = () => {
      if (refreshing) return
      refreshing = true
      void loadSessions()
        .catch(() => undefined)
        .finally(() => {
          refreshing = false
        })
    }

    const timer = setInterval(refreshSessions, SESSION_LIST_REFRESH_INTERVAL_MS)
    const handleFocus = () => refreshSessions()
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      refreshSessions()
    }

    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [isAuthenticated, loadSessions])

  return (
    <div className="h-dvh w-full overflow-hidden">
      {isAuthenticated ? (
        <>
          <MainLayout />
        </>
      ) : (
        <LoginScreen />
      )}
    </div>
  )
}
