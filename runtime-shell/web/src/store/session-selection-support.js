export function readStoredCurrentSessionId(userId, sessions) {
  const storedId = readStoredSessionValue(userId)
  if (!storedId) return ''
  if (sessions.some((session) => session.id === storedId)) return storedId
  writeStoredCurrentSessionId(userId, '')
  return ''
}

export function writeStoredCurrentSessionId(userId, sessionId) {
  const storage = getSessionSelectionStorage()
  const key = buildSessionSelectionStorageKey(userId)
  if (!storage || !key) return
  if (!sessionId) {
    storage.removeItem(key)
    return
  }
  storage.setItem(key, sessionId)
}

export function readLocationCurrentSessionId(sessions) {
  if (typeof window === 'undefined') return ''
  const sessionId = new URL(window.location.href).searchParams.get('session') || ''
  if (!sessionId) return ''
  return sessions.some((session) => session.id === sessionId) ? sessionId : ''
}

export function writeCurrentSessionIdToLocation(sessionId, mode = 'push') {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (sessionId) {
    url.searchParams.set('session', sessionId)
  } else {
    url.searchParams.delete('session')
  }
  const next = url.toString()
  if (next === window.location.href) return
  if (mode === 'replace') {
    window.history.replaceState({}, '', next)
    return
  }
  window.history.pushState({}, '', next)
}

export function clearCurrentSessionLocation() {
  writeCurrentSessionIdToLocation('', 'replace')
}

function readStoredSessionValue(userId) {
  const storage = getSessionSelectionStorage()
  const key = buildSessionSelectionStorageKey(userId)
  if (!storage || !key) return ''
  return storage.getItem(key) || ''
}

function buildSessionSelectionStorageKey(userId) {
  if (!userId) return ''
  return `runtime-shell.current-session.${userId}`
}

function getSessionSelectionStorage() {
  if (typeof window === 'undefined') return null
  return window.localStorage
}
