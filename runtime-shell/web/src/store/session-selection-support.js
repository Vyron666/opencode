export function readStoredCurrentSessionId(userId, sessions) {
  const storedId = readStoredSessionValue(userId)
  if (!storedId) return ''
  if (sessions.some((session) => session.id === storedId)) return storedId
  writeStoredCurrentSessionId(userId, '')
  return ''
}

export function writeStoredCurrentSessionId(userId, sessionId, sessionTitle = '') {
  const storage = getSessionSelectionStorage()
  const key = buildSessionSelectionStorageKey(userId, 'id')
  if (!storage || !key) return
  if (!sessionId) {
    storage.removeItem(key)
    const titleKey = buildSessionSelectionStorageKey(userId, 'title')
    if (titleKey) storage.removeItem(titleKey)
    return
  }
  storage.setItem(key, sessionId)
  const titleKey = buildSessionSelectionStorageKey(userId, 'title')
  if (titleKey) {
    if (sessionTitle) storage.setItem(titleKey, sessionTitle)
    else storage.removeItem(titleKey)
  }
}

export function readStoredCurrentSessionTitle(userId) {
  const storage = getSessionSelectionStorage()
  const key = buildSessionSelectionStorageKey(userId, 'title')
  if (!storage || !key) return ''
  return storage.getItem(key) || ''
}

export function readBootSessionTitle() {
  if (typeof window === 'undefined') return ''
  const storage = getSessionSelectionStorage()
  if (!storage) return ''
  const sessionId = new URL(window.location.href).searchParams.get('session') || ''
  if (!sessionId) return ''
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (!key || !key.startsWith('runtime-shell.current-session.') || !key.endsWith('.id')) continue
    if (storage.getItem(key) !== sessionId) continue
    const titleKey = key.replace(/\.id$/, '.title')
    return storage.getItem(titleKey) || ''
  }
  return ''
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
  const key = buildSessionSelectionStorageKey(userId, 'id')
  if (!storage || !key) return ''
  return storage.getItem(key) || ''
}

function buildSessionSelectionStorageKey(userId, field) {
  if (!userId) return ''
  return `runtime-shell.current-session.${userId}.${field}`
}

function getSessionSelectionStorage() {
  if (typeof window === 'undefined') return null
  return window.localStorage
}
