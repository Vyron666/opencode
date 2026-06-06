import { useEffect, useState } from 'react'
import { useStore } from './store'
import LoginScreen from './components/LoginScreen.jsx'
import MainLayout from './components/MainLayout.jsx'
import { readBootSessionTitle } from './store/session-selection-support'

let authBootstrapPromise = null
const SESSION_LIST_REFRESH_INTERVAL_MS = 2000

export default function App() {
  const isAuthenticated = useStore((state) => state.isAuthenticated)
  const checkAuth = useStore((state) => state.checkAuth)
  const loadSessions = useStore((state) => state.loadSessions)
  const setFlash = useStore((state) => state.setFlash)
  const syncCurrentSessionFromLocation = useStore((state) => state.syncCurrentSessionFromLocation)
  const [authBootstrapping, setAuthBootstrapping] = useState(true)
  const bootSessionTitle = readBootSessionTitle()

  useEffect(() => {
    // 中文/English: dedupe the initial auth bootstrap so React StrictMode
    // does not fire duplicate 401 checks in development.
    authBootstrapPromise ??= checkAuth()
      .then((ok) => {
        if (ok) return loadSessions()
        return null
      })
      .catch((error) => {
        // 中文/English: a cold anonymous visit should fall back to the login
        // screen quietly instead of leaving a stale auth error on the home UI.
        if (error?.status !== 401) {
          setFlash(error instanceof Error ? error.message : String(error))
        }
        return null
      })
      .finally(() => {
        authBootstrapPromise = null
        setAuthBootstrapping(false)
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

  useEffect(() => {
    if (!isAuthenticated) return

    const handlePopState = () => {
      syncCurrentSessionFromLocation()
    }

    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [isAuthenticated, syncCurrentSessionFromLocation])

  return (
    <div className="h-dvh w-full overflow-hidden">
      {authBootstrapping ? (
        <div className="h-dvh grid place-items-center px-6 text-center">
          <div className="panel-card rounded-[28px] px-10 py-8 grid gap-2">
            <div className="text-sm font-semibold text-[var(--text)]">{bootSessionTitle || '正在恢复会话'}</div>
            <div className="text-xs text-[var(--text-muted)]">正在读取登录状态与最近会话，请稍候。</div>
          </div>
        </div>
      ) : isAuthenticated ? (
        <MainLayout />
      ) : (
        <LoginScreen />
      )}
    </div>
  )
}
