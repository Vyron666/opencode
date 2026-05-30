const baseUrl = process.env.RUNTIME_SHELL_SETTINGS_IMPACT_BASE_URL || "http://127.0.0.1:3100"
const adminUsername = process.env.RUNTIME_SHELL_SETTINGS_IMPACT_ADMIN_USERNAME || "admin"
const developerUsername = process.env.RUNTIME_SHELL_SETTINGS_IMPACT_DEVELOPER_USERNAME || "developer"
const password = process.env.RUNTIME_SHELL_SETTINGS_IMPACT_PASSWORD || "change-me"

type ApiEnvelope<T> = {
  code: number
  message: string
  data: T
  requestId: string
}

type ProviderConfig = {
  providerId: string
  name: string
  npm?: string
  api: string
  baseURL: string
  apiKey?: string
  defaultModel: string
  models: Array<{
    id: string
    name: string
    api?: string
  }>
}

const adminJar: string[] = []
const developerJar: string[] = []

const admin = await login(adminJar, adminUsername)
await login(developerJar, developerUsername)

const providerConfigs = await requestJson<ApiEnvelope<{ items: ProviderConfig[] }>>(adminJar, "/api/provider-config")
assert(providerConfigs.status === 200 && providerConfigs.body.data.items.length > 0, "provider-config get failed")
const providerConfig = providerConfigs.body.data.items[0]
const developerProviderConfigs = await requestJson<ApiEnvelope<{ items: ProviderConfig[] }>>(developerJar, "/api/provider-config")
assert(developerProviderConfigs.status === 200, "developer provider-config get should succeed")

const developerProviderConflictSave = await requestJson<ApiEnvelope<{ success: boolean }>>(developerJar, "/api/provider-config/save", {
  method: "POST",
  body: providerConfig,
})
assert(developerProviderConflictSave.status === 409, "developer provider save should conflict with platform shared provider")

const developerPrivateProviderId = `private-provider-${Date.now()}`
const developerPrivateProviderSave = await requestJson<ApiEnvelope<{ success: boolean; providerId: string; reloadedSessionCount: number }>>(
  developerJar,
  "/api/provider-config/save",
  {
    method: "POST",
    body: {
      providerId: developerPrivateProviderId,
      name: "Developer Private Provider",
      api: "@ai-sdk/openai-compatible",
      baseURL: "https://example.invalid/v1",
      apiKey: "developer-private-key",
      defaultModel: `${developerPrivateProviderId}/chat`,
      models: [
        {
          id: "chat",
          name: "Chat",
        },
      ],
    },
  },
)
assert(developerPrivateProviderSave.status === 200, "developer private provider save should succeed")

const workspace = await requestJson<ApiEnvelope<{ id: string; projectId: string }>>(adminJar, "/api/workspace/create", {
  method: "POST",
  body: {
    projectId: admin.projectIds[0],
    name: `settings-impact-${Date.now()}`,
  },
})
assert(workspace.status === 200, "workspace/create failed")

const activeSession = await requestJson<ApiEnvelope<{ id: string }>>(adminJar, "/api/session/create", {
  method: "POST",
  body: {
    title: `Settings Active ${Date.now()}`,
    projectId: workspace.body.data.projectId,
    workspaceId: workspace.body.data.id,
  },
})
assert(activeSession.status === 200, "active session/create failed")

const historySession = await requestJson<ApiEnvelope<{ id: string }>>(adminJar, "/api/session/create", {
  method: "POST",
  body: {
    title: `Settings History ${Date.now()}`,
    projectId: workspace.body.data.projectId,
    workspaceId: workspace.body.data.id,
  },
})
assert(historySession.status === 200, "history session/create failed")

const activeSessionId = activeSession.body.data.id
const historySessionId = historySession.body.data.id

const activeOpen = await requestJson<ApiEnvelope<{ id: string; status: string }>>(adminJar, "/api/acp/session/open", {
  method: "POST",
  body: { businessSessionId: activeSessionId },
})
const historyOpen = await requestJson<ApiEnvelope<{ id: string; status: string }>>(adminJar, "/api/acp/session/open", {
  method: "POST",
  body: { businessSessionId: historySessionId },
})
assert(activeOpen.status === 200, "active session/open failed")
assert(historyOpen.status === 200, "history session/open failed")

const historyClose = await requestJson<ApiEnvelope<{ id: string; status: string }>>(adminJar, "/api/session/close", {
  method: "POST",
  body: { businessSessionId: historySessionId },
})
assert(historyClose.status === 200 && historyClose.body.data.status === "completed", "history session/close failed")

const providerSave = await requestJson<ApiEnvelope<{ success: boolean; providerId: string; reloadedSessionCount: number }>>(
  adminJar,
  "/api/provider-config/save",
  {
    method: "POST",
    body: providerConfig,
  },
)
assert(providerSave.status === 200, "provider save failed")
assert(providerSave.body.data.reloadedSessionCount >= 1, "provider save should reload at least one active session")

const activeAfterSave = await waitForSessionDetail(
  adminJar,
  activeSessionId,
  (session) => session.status === "created",
  "active session should reset to created after provider save",
)
const historyAfterSave = await requestJson<ApiEnvelope<{ session: { status: string } }>>(
  adminJar,
  `/api/session/detail?businessSessionId=${encodeURIComponent(historySessionId)}`,
)
assert(historyAfterSave.status === 200, "history detail after provider save failed")
assert(historyAfterSave.body.data.session.status === "completed", "completed session should stay completed after provider save")

const reopenActive = await requestJson<ApiEnvelope<{ id: string; status: string }>>(adminJar, "/api/acp/session/open", {
  method: "POST",
  body: { businessSessionId: activeSessionId },
})
assert(reopenActive.status === 200 && reopenActive.body.data.status === "active", "reopen active after provider save failed")

console.log(
  JSON.stringify({
    ok: true,
    baseUrl,
    activeSessionId,
    historySessionId,
    providerId: providerSave.body.data.providerId,
    reloadedSessionCount: providerSave.body.data.reloadedSessionCount,
    activeStatusAfterSave: activeAfterSave.status,
    historyStatusAfterSave: historyAfterSave.body.data.session.status,
    developerProviderStatuses: {
      conflictSave: developerProviderConflictSave.status,
      privateSave: developerPrivateProviderSave.status,
    },
  }),
)

async function waitForSessionDetail(
  jar: string[],
  sessionId: string,
  predicate: (session: { status: string }) => boolean,
  message: string,
) {
  let latest: { status: string } | null = null
  const startedAt = Date.now()
  while (Date.now() - startedAt < 10000) {
    const detail = await requestJson<ApiEnvelope<{ session: { status: string } }>>(
      jar,
      `/api/session/detail?businessSessionId=${encodeURIComponent(sessionId)}`,
    )
    assert(detail.status === 200, `session/detail failed for ${sessionId}`)
    latest = detail.body.data.session
    if (predicate(latest)) return latest
    await Bun.sleep(300)
  }
  throw new Error(`${message}: ${JSON.stringify(latest)}`)
}

async function login(jar: string[], username: string) {
  const response = await requestJson<ApiEnvelope<{ user: { projectIds: string[] } }>>(jar, "/api/auth/login", {
    method: "POST",
    body: {
      username,
      password,
    },
  })
  assert(response.status === 200, `${username} login failed`)
  return response.body.data.user
}

async function requestJson<T>(
  jar: string[],
  path: string,
  init: {
    method?: string
    body?: unknown
  } = {},
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method || "GET",
    headers: {
      ...(jar.length ? { Cookie: jar.join("; ") } : {}),
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  mergeCookies(jar, response)
  const text = await response.text()
  return {
    status: response.status,
    body: JSON.parse(text) as T,
  }
}

function mergeCookies(jar: string[], response: Response) {
  const raw = response.headers.get("set-cookie")
  if (!raw) return
  raw
    .split(/,(?=[^;]+=[^;]+)/)
    .map((item) => item.split(";")[0]?.trim())
    .filter((item): item is string => Boolean(item))
    .forEach((item) => {
      const name = item.split("=")[0]
      const index = jar.findIndex((existing) => existing.startsWith(`${name}=`))
      if (index >= 0) {
        jar[index] = item
        return
      }
      jar.push(item)
    })
}

function assert(condition: unknown, message: string): asserts condition {
  if (condition) return
  throw new Error(message)
}
