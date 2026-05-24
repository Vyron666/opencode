import { useEffect } from 'react'
import { useStore } from './store'
import LoginScreen from './components/LoginScreen.jsx'
import MainLayout from './components/MainLayout.jsx'

let authBootstrapPromise = null

export default function App() {
  const { isAuthenticated, checkAuth, loadSessions, disconnectSSE } = useStore()

  useEffect(() => {
    // 中文/English: dedupe the initial auth bootstrap so React StrictMode does not fire duplicate 401 checks in dev.
    authBootstrapPromise ??= checkAuth().then((ok) => {
      if (ok) return loadSessions()
      return null
    })

    return () => disconnectSSE()
  }, [checkAuth, loadSessions, disconnectSSE])

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
