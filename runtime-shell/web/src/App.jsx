import { useEffect } from 'react'
import { useStore } from './store'
import LoginScreen from './components/LoginScreen.jsx'
import MainLayout from './components/MainLayout.jsx'

let authBootstrapPromise = null

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
