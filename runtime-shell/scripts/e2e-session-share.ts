const baseUrl = process.env.RUNTIME_SHELL_SHARE_BASE_URL || "http://127.0.0.1:3100"
const ownerPassword = process.env.RUNTIME_SHELL_SHARE_OWNER_PASSWORD || "change-me"
const targetPassword = process.env.RUNTIME_SHELL_SHARE_TARGET_PASSWORD || "change-me"

type ApiEnvelope<T> = {
  code: number
  message: string
  data: T
  requestId: string
}

type SessionSummary = {
  id: string
  status: string
}

type WorkspaceSummary = {
  id: string
}

type UserSummary = {
  id: string
  username: string
  projectIds: string[]
  workspaceIds: string[]
}

const ownerJar: string[] = []
const targetJar: string[] = []

const ownerLogin = await login("developer-secondary", ownerPassword, ownerJar)
const targetLogin = await login("developer", targetPassword, targetJar)

const ownerList = await requestJson<ApiEnvelope<{ items: SessionSummary[]; workspaces: WorkspaceSummary[] }>>(
  ownerJar,
  "/api/session/list",
)
assert(ownerList.status === 200 && ownerList.body.data.workspaces.length === 1, "owner session/list failed")

const ownerSession = await requestJson<ApiEnvelope<SessionSummary>>(ownerJar, "/api/session/create", {
  method: "POST",
  body: {
    title: `Shared Session ${Date.now()}`,
    projectId: ownerLogin.user.projectIds[0],
    workspaceId: ownerList.body.data.workspaces[0].id,
  },
})
assert(ownerSession.status === 200, "owner session/create failed")

const forbiddenBeforeShare = await requestJson<ApiEnvelope<{ session: SessionSummary }>>(
  targetJar,
  `/api/session/detail?businessSessionId=${ownerSession.body.data.id}`,
)
assert(forbiddenBeforeShare.status === 403, "target user should not read session before share")

const shareCreate = await requestJson<ApiEnvelope<{ binding: { id: string } }>>(ownerJar, "/api/session/share/create", {
  method: "POST",
  body: {
    businessSessionId: ownerSession.body.data.id,
    targetUserId: targetLogin.user.id,
  },
})
assert(shareCreate.status === 200, "session/share/create failed")

const detailAfterShare = await requestJson<ApiEnvelope<{ session: SessionSummary; events: unknown[] }>>(
  targetJar,
  `/api/session/detail?businessSessionId=${ownerSession.body.data.id}`,
)
assert(detailAfterShare.status === 200, "target user should read shared session detail")

const openAfterShare = await requestJson<ApiEnvelope<SessionSummary>>(targetJar, "/api/acp/session/open", {
  method: "POST",
  body: { businessSessionId: ownerSession.body.data.id },
})
assert(openAfterShare.status === 200, "target user should open shared session")

const inputAfterShare = await requestJson<ApiEnvelope<{ accepted: boolean }>>(targetJar, "/api/acp/session/input", {
  method: "POST",
  body: {
    businessSessionId: ownerSession.body.data.id,
    parts: [{ type: "text", text: "请简短回复：share ok" }],
  },
})
assert(inputAfterShare.status === 200 && inputAfterShare.body.data.accepted, "target user should prompt shared session")

const cancelAfterShare = await requestJson<ApiEnvelope<{ success: boolean }>>(targetJar, "/api/acp/session/cancel", {
  method: "POST",
  body: { businessSessionId: ownerSession.body.data.id },
})
assert(
  cancelAfterShare.status === 200 || cancelAfterShare.status === 409,
  `shared session cancel returned unexpected status: ${cancelAfterShare.status}`,
)

const forbiddenClose = await requestJson<ApiEnvelope<SessionSummary>>(targetJar, "/api/session/close", {
  method: "POST",
  body: { businessSessionId: ownerSession.body.data.id },
})
assert(forbiddenClose.status === 403, "target user should not close shared session")

const forbiddenFork = await requestJson<ApiEnvelope<SessionSummary>>(targetJar, "/api/acp/session/fork", {
  method: "POST",
  body: {
    businessSessionId: ownerSession.body.data.id,
    title: `Forbidden Fork ${Date.now()}`,
  },
})
assert(forbiddenFork.status === 403, "target user should not fork shared session")

const forbiddenMode = await requestJson<ApiEnvelope<{ success: boolean }>>(targetJar, "/api/acp/session/mode/update", {
  method: "POST",
  body: {
    businessSessionId: ownerSession.body.data.id,
    modeId: "forbidden-mode",
  },
})
assert(forbiddenMode.status === 403, "target user should not update shared session mode")

const forbiddenProviderSave = await requestJson<ApiEnvelope<{ success: boolean }>>(targetJar, "/api/provider-config/save", {
  method: "POST",
  body: {
    providerId: "share-test",
    name: "Share Test",
    api: "responses",
    baseURL: "https://example.com",
    apiKey: "share-test-key",
    defaultModel: "share-test/model",
    models: [{ id: "model", name: "model" }],
  },
})
assert(forbiddenProviderSave.status === 403, "target user should not save provider config")

const forbiddenShareAgain = await requestJson<ApiEnvelope<{ binding: { id: string } }>>(
  targetJar,
  "/api/session/share/create",
  {
    method: "POST",
    body: {
      businessSessionId: ownerSession.body.data.id,
      targetUserId: ownerLogin.user.id,
    },
  },
)
assert(forbiddenShareAgain.status === 403, "target user should not reshare shared session")

const forbiddenCreateInSharedWorkspace = await requestJson<ApiEnvelope<SessionSummary>>(targetJar, "/api/session/create", {
  method: "POST",
  body: {
    title: `Forbidden Shared Workspace ${Date.now()}`,
    projectId: ownerLogin.user.projectIds[0],
    workspaceId: ownerList.body.data.workspaces[0].id,
  },
})
assert(
  forbiddenCreateInSharedWorkspace.status === 403,
  "target user should not create another session in shared workspace",
)

const shareDelete = await requestJson<ApiEnvelope<{ success: boolean }>>(ownerJar, "/api/session/share/delete", {
  method: "POST",
  body: {
    businessSessionId: ownerSession.body.data.id,
    targetUserId: targetLogin.user.id,
  },
})
assert(shareDelete.status === 200, "session/share/delete failed")

const forbiddenAfterDelete = await requestJson<ApiEnvelope<{ session: SessionSummary }>>(
  targetJar,
  `/api/session/detail?businessSessionId=${ownerSession.body.data.id}`,
)
assert(forbiddenAfterDelete.status === 403, "target user should lose shared session access after revoke")

console.log(
  JSON.stringify({
    ok: true,
    baseUrl,
    ownerSessionId: ownerSession.body.data.id,
    shareBindingId: shareCreate.body.data.binding.id,
    cancelStatus: cancelAfterShare.status,
  }),
)

async function login(username: string, password: string, jar: string[]) {
  const response = await requestJson<ApiEnvelope<{ user: UserSummary }>>(jar, "/api/auth/login", {
    method: "POST",
    body: { username, password },
  })
  assert(response.status === 200, `${username} login failed`)
  return response.body.data
}

async function requestJson<T>(
  jar: string[],
  path: string,
  init: {
    method?: string
    body?: unknown
  } = {},
) {
  const response = await request(jar, path, init)
  return {
    status: response.status,
    body: (await response.json()) as T,
  }
}

async function request(
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
  return response
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
