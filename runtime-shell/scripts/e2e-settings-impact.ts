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
const developer = await login(developerJar, developerUsername)

const providerConfigs = await requestJson<ApiEnvelope<{ items: ProviderConfig[] }>>(adminJar, "/api/provider-config")
assert(providerConfigs.status === 200 && providerConfigs.body.data.items.length > 0, "provider-config get failed")
const providerConfig = providerConfigs.body.data.items[0]
const developerProviderConfigs = await requestJson<ApiEnvelope<{ items: ProviderConfig[] }>>(developerJar, "/api/provider-config")
assert(developerProviderConfigs.status === 200, "developer provider-config get should succeed")
const adminSharedProviderId = `shared-provider-${Date.now()}`
const developerPrivateProviderId = `private-provider-${Date.now()}`
let activeSessionId = ""
let historySessionId = ""
let developerSessionId = ""
let developerSecondSessionId = ""
let providerSaveStatus = 0
let activeStatusAfterSave = ""
let historyStatusAfterSave = ""
let developerProviderConflictStatus = 0
let developerPrivateProviderSaveStatus = 0
let adminSharedProviderSaveStatus = 0
let developerCapabilityModelId = ""
let developerSecondCapabilityModelId = ""

try {
  const adminSharedProviderSave = await requestJson<ApiEnvelope<{ success: boolean; providerId: string; reloadedSessionCount: number }>>(
    adminJar,
    "/api/provider-config/save",
    {
      method: "POST",
      body: {
        providerId: adminSharedProviderId,
        name: "Admin Shared Provider",
        api: "@ai-sdk/openai-compatible",
        baseURL: "https://example.invalid/shared",
        apiKey: "admin-shared-key",
        defaultModel: `${adminSharedProviderId}/chat`,
        models: [
          {
            id: "chat",
            name: "Shared Chat",
          },
        ],
      },
    },
  )
  adminSharedProviderSaveStatus = adminSharedProviderSave.status
  assert(adminSharedProviderSave.status === 200, "admin shared provider save should succeed")
  const developerProviderListAfterShared = await requestJson<ApiEnvelope<{ items: ProviderConfig[] }>>(
    developerJar,
    "/api/provider-config",
  )
  assert(
    developerProviderListAfterShared.status === 200
      && developerProviderListAfterShared.body.data.items.some((item) => item.providerId === adminSharedProviderId),
    "developer should see admin shared provider",
  )

  const developerProviderConflictSave = await requestJson<ApiEnvelope<{ success: boolean }>>(developerJar, "/api/provider-config/save", {
    method: "POST",
    body: {
      providerId: adminSharedProviderId,
      name: "Developer Conflict Provider",
      api: "@ai-sdk/openai-compatible",
      baseURL: "https://example.invalid/conflict",
      apiKey: "developer-conflict-key",
      defaultModel: `${adminSharedProviderId}/chat`,
      models: [
        {
          id: "chat",
          name: "Conflict Chat",
        },
      ],
    },
  })
  developerProviderConflictStatus = developerProviderConflictSave.status
  assert(developerProviderConflictSave.status === 409, "developer provider save should conflict with platform shared provider")

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
  developerPrivateProviderSaveStatus = developerPrivateProviderSave.status
  assert(developerPrivateProviderSave.status === 200, "developer private provider save should succeed")
  const adminProviderListAfterPrivate = await requestJson<ApiEnvelope<{ items: ProviderConfig[] }>>(adminJar, "/api/provider-config")
  assert(
    adminProviderListAfterPrivate.status === 200
      && !adminProviderListAfterPrivate.body.data.items.some((item) => item.providerId === developerPrivateProviderId),
    "admin should not see developer private provider",
  )

  const developerWorkspace = await requestJson<ApiEnvelope<{ id: string; projectId: string }>>(developerJar, "/api/workspace/create", {
    method: "POST",
    body: {
      projectId: developer.projectIds[0],
      name: `settings-private-${Date.now()}`,
    },
  })
  assert(developerWorkspace.status === 200, "developer workspace/create failed")
  const developerSession = await requestJson<ApiEnvelope<{ id: string }>>(developerJar, "/api/session/create", {
    method: "POST",
    body: {
      title: `Developer Private ${Date.now()}`,
      projectId: developerWorkspace.body.data.projectId,
      workspaceId: developerWorkspace.body.data.id,
    },
  })
  assert(developerSession.status === 200, "developer session/create failed")
  developerSessionId = developerSession.body.data.id
  const developerOpen = await requestJson<ApiEnvelope<{ id: string; status: string }>>(developerJar, "/api/acp/session/open", {
    method: "POST",
    body: { businessSessionId: developerSessionId },
  })
  assert(developerOpen.status === 200 && developerOpen.body.data.status === "active", "developer session/open failed")
  const developerDetail = await waitForSessionDetail(
    developerJar,
    developerSessionId,
    (session) =>
      session.status === "active"
      && typeof session.capabilityState?.modelId === "string"
      && session.capabilityState.modelId === `${developerPrivateProviderId}/chat`,
    "developer private provider model should become the active runtime model",
  )
  developerCapabilityModelId = developerDetail.capabilityState?.modelId || ""

  const developerSecondWorkspace = await requestJson<ApiEnvelope<{ id: string; projectId: string }>>(developerJar, "/api/workspace/create", {
    method: "POST",
    body: {
      projectId: developer.projectIds[0],
      name: `settings-private-second-${Date.now()}`,
    },
  })
  assert(developerSecondWorkspace.status === 200, "developer second workspace/create failed")
  const developerSecondSession = await requestJson<ApiEnvelope<{ id: string }>>(developerJar, "/api/session/create", {
    method: "POST",
    body: {
      title: `Developer Private Second ${Date.now()}`,
      projectId: developerSecondWorkspace.body.data.projectId,
      workspaceId: developerSecondWorkspace.body.data.id,
    },
  })
  assert(developerSecondSession.status === 200, "developer second session/create failed")
  developerSecondSessionId = developerSecondSession.body.data.id
  const developerSecondOpen = await requestJson<ApiEnvelope<{ id: string; status: string }>>(developerJar, "/api/acp/session/open", {
    method: "POST",
    body: { businessSessionId: developerSecondSessionId },
  })
  assert(developerSecondOpen.status === 200 && developerSecondOpen.body.data.status === "active", "developer second session/open failed")
  const developerSecondDetail = await waitForSessionDetail(
    developerJar,
    developerSecondSessionId,
    (session) =>
      session.status === "active"
      && typeof session.capabilityState?.modelId === "string"
      && session.capabilityState.modelId === `${developerPrivateProviderId}/chat`,
    "developer private provider model should stay active across a second workspace/session",
  )
  developerSecondCapabilityModelId = developerSecondDetail.capabilityState?.modelId || ""

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

  activeSessionId = activeSession.body.data.id
  historySessionId = historySession.body.data.id

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
  providerSaveStatus = providerSave.status
  assert(providerSave.status === 200, "provider save failed")
  const activeAfterSave =
    providerSave.body.data.reloadedSessionCount >= 1
      ? await waitForSessionDetail(
          adminJar,
          activeSessionId,
          (session) => session.status === "created",
          "active session should reset to created after provider save when it is affected",
        )
      : await waitForSessionDetail(
          adminJar,
          activeSessionId,
          (session) => session.status === "active",
          "active session should stay active when provider save does not affect its current model",
        )
  activeStatusAfterSave = activeAfterSave.status
  const historyAfterSave = await requestJson<ApiEnvelope<{ session: { status: string } }>>(
    adminJar,
    `/api/session/detail?businessSessionId=${encodeURIComponent(historySessionId)}`,
  )
  assert(historyAfterSave.status === 200, "history detail after provider save failed")
  assert(historyAfterSave.body.data.session.status === "completed", "completed session should stay completed after provider save")
  historyStatusAfterSave = historyAfterSave.body.data.session.status

  const reopenActive = await requestJson<ApiEnvelope<{ id: string; status: string }>>(adminJar, "/api/acp/session/open", {
    method: "POST",
    body: { businessSessionId: activeSessionId },
  })
  assert(reopenActive.status === 200 && reopenActive.body.data.status === "active", "reopen active after provider save failed")
} finally {
  if (adminSharedProviderSaveStatus === 200) {
    await requestJson<ApiEnvelope<{ success: boolean }>>(adminJar, "/api/provider-config/delete", {
      method: "POST",
      body: {
        providerId: adminSharedProviderId,
        source: "platform_shared",
      },
    }).catch(() => null)
  }
  await requestJson<ApiEnvelope<{ success: boolean }>>(developerJar, "/api/provider-config/delete", {
    method: "POST",
    body: {
      providerId: developerPrivateProviderId,
      source: "user_private",
    },
  }).catch(() => null)
}

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  activeSessionId,
  historySessionId,
  providerSaveStatus,
  activeStatusAfterSave,
  historyStatusAfterSave,
  adminSharedProviderSaveStatus,
  developerCapabilityModelId,
  developerSecondCapabilityModelId,
  developerProviderStatuses: {
    conflictSave: developerProviderConflictStatus,
    privateSave: developerPrivateProviderSaveStatus,
  },
}))

async function waitForSessionDetail(
  jar: string[],
  sessionId: string,
  predicate: (session: { status: string; capabilityState?: { modelId?: string } }) => boolean,
  message: string,
) {
  let latest: { status: string; capabilityState?: { modelId?: string } } | null = null
  const startedAt = Date.now()
  while (Date.now() - startedAt < 10000) {
    const detail = await requestJson<ApiEnvelope<{ session: { status: string; capabilityState?: { modelId?: string } } }>>(
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
