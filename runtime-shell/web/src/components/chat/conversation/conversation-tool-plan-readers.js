export function readToolBlockType(payload, currentType) {
  if (isTodoToolPayload(payload)) return 'todo'
  return currentType || 'tool'
}

export function isTodoToolPayload(payload) {
  if (Array.isArray(payload?.rawInput?.todos)) return true
  if (typeof payload?.toolName === 'string' && payload.toolName.toLowerCase() === 'todowrite') return true
  if (typeof payload?.title === 'string' && payload.title.toLowerCase() === 'todowrite') return true
  return false
}

export function readTodoItems(input, fallback = []) {
  if (!Array.isArray(input)) return fallback
  return input.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const content = typeof item.content === 'string' ? item.content : ''
    if (!content) return []
    return [
      {
        status: typeof item.status === 'string' ? item.status : 'pending',
        content,
      },
    ]
  })
}

export function readPlanBlock(payload) {
  if (!payload) return null
  const entries = readPlanEntries(payload)
  const message = readPlanMessage(payload)
  if (!message && entries.length === 0) return null
  return {
    kind: isTodoPlanPayload(payload, entries) ? 'todo' : 'plan',
    message,
    entries,
  }
}

export function readPlanEntries(payload) {
  if (Array.isArray(payload?.entries)) return payload.entries.flatMap((item) => readPlanEntry(item))
  if (Array.isArray(payload?.plan)) return payload.plan.flatMap((item) => readPlanEntry(item))
  return []
}

export function readPlanEntry(item) {
  if (!item || typeof item !== 'object') return []
  const text = item.content || item.step || item.title || item.text
  if (typeof text !== 'string' || !text) return []
  return [
    {
      status: typeof item.status === 'string' ? item.status : 'pending',
      text,
    },
  ]
}

export function readPlanMessage(payload) {
  if (typeof payload?.text === 'string') return payload.text
  if (typeof payload?.explanation === 'string') return payload.explanation
  if (typeof payload?.plan === 'string') return payload.plan
  if (Array.isArray(payload?.entries) || Array.isArray(payload?.plan)) return ''
  return JSON.stringify(payload, null, 2)
}

export function isTodoPlanPayload(payload, entries) {
  if (!Array.isArray(payload?.entries) || entries.length === 0) return false
  return payload.entries.every((item) => item && typeof item === 'object' && typeof item.content === 'string' && !('step' in item))
}
