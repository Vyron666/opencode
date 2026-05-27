const baseUrl = process.env.RUNTIME_SHELL_SCOPE_BASE_URL || "http://127.0.0.1:3100"
const adminPassword = process.env.RUNTIME_SHELL_SCOPE_ADMIN_PASSWORD || "change-me"
const developerPassword = process.env.RUNTIME_SHELL_SCOPE_DEVELOPER_PASSWORD || "change-me"
const developerSecondaryPassword = process.env.RUNTIME_SHELL_SCOPE_DEVELOPER_SECONDARY_PASSWORD || "change-me"

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

const adminJar: string[] = []
const developerJar: string[] = []
const developerSecondaryJar: string[] = []

const adminLogin = await login("admin", adminPassword, adminJar)
assert(adminLogin.user.projectIds.length === 2, "admin scope not initialized")
const developerLogin = await login("developer", developerPassword, developerJar)
const developerSecondaryLogin = await login("developer-secondary", developerSecondaryPassword, developerSecondaryJar)

const developerList = await requestJson<ApiEnvelope<{ items: SessionSummary[]; workspaces: WorkspaceSummary[] }>>(
  developerJar,
  "/api/session/list",
)
assert(developerList.status === 200, "developer session/list failed")
assert(developerList.body.data.workspaces.length === 1, "developer workspace scope mismatch")

const developerSecondaryList = await requestJson<ApiEnvelope<{ items: SessionSummary[]; workspaces: WorkspaceSummary[] }>>(
  developerSecondaryJar,
  "/api/session/list",
)
assert(developerSecondaryList.status === 200, "developer-secondary session/list failed")
assert(developerSecondaryList.body.data.workspaces.length === 1, "developer-secondary workspace scope mismatch")
assert(
  developerList.body.data.workspaces[0].id !== developerSecondaryList.body.data.workspaces[0].id,
  "developers must not share workspace scope by default",
)

const developerSession = await requestJson<ApiEnvelope<SessionSummary>>(developerJar, "/api/session/create", {
  method: "POST",
  body: {
    title: `Developer Scope ${Date.now()}`,
    projectId: developerLogin.user.projectIds[0],
    workspaceId: developerList.body.data.workspaces[0].id,
  },
})
assert(developerSession.status === 200, "developer session/create failed")

const developerSecondaryForbiddenDetail = await requestJson<ApiEnvelope<{ session: SessionSummary }>>(
  developerSecondaryJar,
  `/api/session/detail?businessSessionId=${developerSession.body.data.id}`,
)
assert(developerSecondaryForbiddenDetail.status === 403, "developer-secondary should not read developer session detail")

const developerSecondaryForbiddenEvents = await request(
  developerSecondaryJar,
  `/api/acp/session/events?businessSessionId=${developerSession.body.data.id}`,
)
assert(developerSecondaryForbiddenEvents.status === 403, "developer-secondary should not open developer event stream")

const developerSecondaryForbiddenPermissions = await requestJson<ApiEnvelope<{ items: unknown[] }>>(
  developerSecondaryJar,
  `/api/acp/session/permission/list?businessSessionId=${developerSession.body.data.id}`,
)
assert(
  developerSecondaryForbiddenPermissions.status === 403,
  "developer-secondary should not list developer permissions",
)

const developerSecondaryCreateForbidden = await requestJson<ApiEnvelope<SessionSummary>>(
  developerSecondaryJar,
  "/api/session/create",
  {
    method: "POST",
    body: {
      title: `Developer Secondary Forbidden ${Date.now()}`,
      projectId: developerLogin.user.projectIds[0],
      workspaceId: developerList.body.data.workspaces[0].id,
    },
  },
)
assert(
  developerSecondaryCreateForbidden.status === 403,
  "developer-secondary should not create session in developer workspace",
)

const developerSecondarySession = await requestJson<ApiEnvelope<SessionSummary>>(
  developerSecondaryJar,
  "/api/session/create",
  {
    method: "POST",
    body: {
      title: `Developer Secondary Scope ${Date.now()}`,
      projectId: developerSecondaryLogin.user.projectIds[0],
      workspaceId: developerSecondaryList.body.data.workspaces[0].id,
    },
  },
)
assert(developerSecondarySession.status === 200, "developer-secondary scoped session/create failed")

const developerListAfter = await requestJson<ApiEnvelope<{ items: SessionSummary[] }>>(developerJar, "/api/session/list")
assert(
  developerListAfter.status === 200 &&
    developerListAfter.body.data.items.every((item) => item.id !== developerSecondarySession.body.data.id),
  "developer should not list developer-secondary session",
)

console.log(
  JSON.stringify({
    ok: true,
    baseUrl,
    developerSessionId: developerSession.body.data.id,
    developerSecondarySessionId: developerSecondarySession.body.data.id,
    developerWorkspaceId: developerList.body.data.workspaces[0].id,
    developerSecondaryWorkspaceId: developerSecondaryList.body.data.workspaces[0].id,
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
