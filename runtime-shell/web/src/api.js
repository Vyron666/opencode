const BASE = ''

async function request(url, options = {}) {
  const response = await fetch(`${BASE}${url}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...options.headers },
    ...options,
  })
  const body = parseJsonText(await response.text())
  const envelope = requireApiEnvelope(body, response.status)

  if (!response.ok || envelope.code !== 0) {
    throw createApiError(response.status, envelope)
  }

  return envelope.data
}

export const api = {
  login: (username, password) =>
    request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  logout: () => request('/api/auth/logout', { method: 'POST' }),
  me: () => request('/api/auth/me'),
  workerList: () => request('/api/worker/list'),
  sessionList: () => request('/api/session/list'),

  sessionDetail: (businessSessionId) =>
    request(`/api/session/detail?businessSessionId=${encodeURIComponent(businessSessionId)}`),

  createSession: (data) =>
    request('/api/session/create', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  shareSession: (businessSessionId, targetUserId) =>
    request('/api/session/share/create', {
      method: 'POST',
      body: JSON.stringify({ businessSessionId, targetUserId }),
    }),

  unshareSession: (businessSessionId, targetUserId) =>
    request('/api/session/share/delete', {
      method: 'POST',
      body: JSON.stringify({ businessSessionId, targetUserId }),
    }),

  closeSession: (businessSessionId) =>
    request('/api/session/close', {
      method: 'POST',
      body: JSON.stringify({ businessSessionId }),
    }),

  openSession: (businessSessionId) =>
    request('/api/acp/session/open', {
      method: 'POST',
      body: JSON.stringify({ businessSessionId }),
    }),

  loadSession: (businessSessionId) =>
    request('/api/acp/session/load', {
      method: 'POST',
      body: JSON.stringify({ businessSessionId }),
    }),

  resumeSession: (businessSessionId) =>
    request('/api/acp/session/resume', {
      method: 'POST',
      body: JSON.stringify({ businessSessionId }),
    }),

  forkSession: (businessSessionId, title) =>
    request('/api/acp/session/fork', {
      method: 'POST',
      body: JSON.stringify({ businessSessionId, title }),
    }),

  sendInput: (businessSessionId, parts) =>
    request('/api/acp/session/input', {
      method: 'POST',
      body: JSON.stringify({ businessSessionId, parts }),
    }),

  cancelSessionPrompt: (businessSessionId) =>
    request('/api/acp/session/cancel', {
      method: 'POST',
      body: JSON.stringify({ businessSessionId }),
    }),

  updateMode: (businessSessionId, modeId) =>
    request('/api/acp/session/mode/update', {
      method: 'POST',
      body: JSON.stringify({ businessSessionId, modeId }),
    }),

  updateModel: (businessSessionId, modelId) =>
    request('/api/acp/session/model/update', {
      method: 'POST',
      body: JSON.stringify({ businessSessionId, modelId }),
    }),

  updateConfig: (businessSessionId, configId, value) =>
    request('/api/acp/session/config/update', {
      method: 'POST',
      body: JSON.stringify({ businessSessionId, configId, value }),
    }),

  permissionRespond: (businessSessionId, requestId, approved, optionId) =>
    request('/api/acp/session/permission/respond', {
      method: 'POST',
      body: JSON.stringify({ businessSessionId, requestId, approved, optionId }),
    }),

  questionRespond: (businessSessionId, requestId, action, content) =>
    request('/api/acp/session/question/respond', {
      method: 'POST',
      body: JSON.stringify({ businessSessionId, requestId, action, content }),
    }),

  permissionList: (businessSessionId) =>
    request(`/api/acp/session/permission/list${businessSessionId ? `?businessSessionId=${encodeURIComponent(businessSessionId)}` : ''}`),

  questionList: (businessSessionId) =>
    request(`/api/acp/session/question/list${businessSessionId ? `?businessSessionId=${encodeURIComponent(businessSessionId)}` : ''}`),

  customModels: {
    get: () => request('/api/custom-models'),
    save: (models) =>
      request('/api/custom-models', {
        method: 'POST',
        body: JSON.stringify({ models }),
      }),
  },

  providerConfig: {
    get: () => request('/api/provider-config'),
    save: (config) =>
      request('/api/provider-config/save', {
        method: 'POST',
        body: JSON.stringify(config),
      }),
  },
}

export function createEventSource(sessionId, onEvent, onError, afterEventId) {
  const search = new URLSearchParams({ businessSessionId: sessionId })

  if (afterEventId) {
    // 中文/English: pass the last persisted event id so reconnect only requests incremental events.
    search.set('afterEventId', afterEventId)
  }

  const eventSource = new EventSource(`${BASE}/api/acp/session/events?${search.toString()}`)

  eventSource.addEventListener('message', (event) => {
    if (!event.data) return
    try {
      const payload = parseJsonText(event.data)
      if (payload.type === 'heartbeat') return
      onEvent(payload)
    } catch (error) {
      console.error('[sse message parse failed]', error)
      onError?.(error)
    }
  })

  eventSource.addEventListener('error', (error) => {
    onError?.(error)
  })

  return eventSource
}

function parseJsonText(text) {
  if (!text) {
    throw new Error('empty response body')
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(text)
  }
}

function requireApiEnvelope(body, status) {
  if (!body || typeof body !== 'object') {
    throw new Error(`invalid response body with status ${status}`)
  }
  if (!('code' in body) || !('message' in body) || !('requestId' in body)) {
    throw new Error(`invalid response envelope with status ${status}`)
  }
  return body
}

function createApiError(status, envelope) {
  const error = new Error(readStatusMessage(status, envelope.message))
  error.name = 'ApiError'
  error.status = status
  error.code = envelope.code
  error.requestId = envelope.requestId
  error.details = envelope.details
  return error
}

function readStatusMessage(status, message) {
  if (status === 401) return '登录状态已失效，请重新登录'
  if (status === 403) return message || '当前账号没有执行该操作的权限'
  if (status === 404) return message || '请求的资源不存在或已不可见'
  if (status === 409) return message || '当前状态不允许执行该操作'
  return message || `request failed with status ${status}`
}
