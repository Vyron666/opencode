const assistantStreamListeners = new Map()
const assistantStreamActivityListeners = new Set()

export function publishAssistantChunk(blockKey, chunk, chunkVersion) {
  if (!blockKey || !chunk) return
  const payload = {
    chunk,
    chunkVersion,
    publishedAt: performance.now(),
  }
  const listeners = assistantStreamListeners.get(blockKey)
  if (listeners?.size) listeners.forEach((listener) => listener(payload))
  if (assistantStreamActivityListeners.size) assistantStreamActivityListeners.forEach((listener) => listener(payload))
}

export function subscribeAssistantChunk(blockKey, listener) {
  if (!blockKey || typeof listener !== 'function') return () => {}
  const listeners = assistantStreamListeners.get(blockKey) || new Set()
  listeners.add(listener)
  assistantStreamListeners.set(blockKey, listeners)

  return () => {
    const currentListeners = assistantStreamListeners.get(blockKey)
    if (!currentListeners) return
    currentListeners.delete(listener)
    if (currentListeners.size === 0) assistantStreamListeners.delete(blockKey)
  }
}

export function subscribeAssistantStreamActivity(listener) {
  if (typeof listener !== 'function') return () => {}
  assistantStreamActivityListeners.add(listener)
  return () => assistantStreamActivityListeners.delete(listener)
}
