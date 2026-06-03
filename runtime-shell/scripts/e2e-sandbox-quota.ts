export {}

const baseUrl = process.env.RUNTIME_SHELL_SMOKE_BASE_URL || "http://127.0.0.1:3100"
const username = process.env.RUNTIME_SHELL_SMOKE_USERNAME || "admin"
const password = process.env.RUNTIME_SHELL_SMOKE_PASSWORD || "change-me"
const cookieJar: string[] = []

type ApiEnvelope<T> = {
  code: number
  message: string
  data: T
  requestId: string
}

type MeResponse = {
  user: {
    username: string
    tenantId: string
    organizationId: string
    projectIds: string[]
  }
}

type SessionSummary = {
  id: string
  status: string
}

type WorkspaceSummary = {
  id: string
  projectId: string
}

const login = await requestJson<ApiEnvelope<MeResponse>>("/api/auth/login", {
  method: "POST",
  body: { username, password },
})
assert(login.status === 200 && login.body.code === 0, "login failed")

const me = await requestJson<ApiEnvelope<MeResponse>>("/api/auth/me")
assert(me.status === 200, "auth/me failed")
const projectId = me.body.data.user.projectIds[0]

try {
  const update = await requestJson<ApiEnvelope<Record<string, unknown>>>("/api/system/quotas/update", {
    method: "POST",
    body: {
      tenantId: me.body.data.user.tenantId,
      organizationId: me.body.data.user.organizationId,
      scopeType: "project",
      scopeId: projectId,
      enabled: true,
      maxActiveSessions: 0,
    },
  })
  assert(update.status === 200, "quota update failed")

  const workspace = await requestJson<ApiEnvelope<WorkspaceSummary>>("/api/workspace/create", {
    method: "POST",
    body: {
      projectId,
      name: `quota-${Date.now()}`,
    },
  })
  assert(workspace.status === 200, "workspace/create failed")

  const create = await requestJson<ApiEnvelope<SessionSummary>>("/api/session/create", {
    method: "POST",
    body: {
      title: `Quota ${Date.now()}`,
      projectId,
      workspaceId: workspace.body.data.id,
    },
  })
  assert(create.status === 429, `session/create should be quota limited, got ${create.status}`)

  console.log(JSON.stringify({
    ok: true,
    quotaRejectedStatus: create.status,
    projectId,
  }))
} finally {
  // 中文/English: restore the project quota policy so this probe does not leave
  // later manual or automated verification stuck behind a test-only hard limit.
  await requestJson<ApiEnvelope<Record<string, unknown>>>("/api/system/quotas/update", {
    method: "POST",
    body: {
      tenantId: me.body.data.user.tenantId,
      organizationId: me.body.data.user.organizationId,
      scopeType: "project",
      scopeId: projectId,
      enabled: false,
    },
  })
}

async function requestJson<T>(path: string, init: { method?: string; body?: unknown } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method || "GET",
    headers: {
      ...(cookieJar.length ? { Cookie: cookieJar.join("; ") } : {}),
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  mergeCookies(response)
  return {
    status: response.status,
    body: (await response.json()) as T,
  }
}

function mergeCookies(response: Response) {
  const raw = response.headers.get("set-cookie")
  if (!raw) return
  raw
    .split(/,(?=[^;]+=[^;]+)/)
    .map((item) => item.split(";")[0]?.trim())
    .filter((item): item is string => Boolean(item))
    .forEach((item) => {
      const name = item.split("=")[0]
      const index = cookieJar.findIndex((existing) => existing.startsWith(`${name}=`))
      if (index >= 0) {
        cookieJar[index] = item
        return
      }
      cookieJar.push(item)
    })
}

function assert(condition: unknown, message: string): asserts condition {
  if (condition) return
  throw new Error(message)
}
