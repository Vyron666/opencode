export {}

const baseUrl = process.env.RUNTIME_SHELL_SMOKE_BASE_URL || "http://127.0.0.1:3100"
const username = process.env.RUNTIME_SHELL_SMOKE_USERNAME || "admin"
const password = process.env.RUNTIME_SHELL_SMOKE_PASSWORD || "change-me"
const concurrency = Number(process.env.RUNTIME_SHELL_BENCH_CONCURRENCY || "3")
const cookieJar: string[] = []

type ApiEnvelope<T> = {
  code: number
  message: string
  data: T
  requestId: string
}

type WorkspaceSummary = {
  id: string
  projectId: string
}

type SessionSummary = {
  id: string
}

const login = await requestJson<ApiEnvelope<{ user: { projectIds: string[] } }>>("/api/auth/login", {
  method: "POST",
  body: { username, password },
})
assert(login.status === 200, "login failed")

const projectId = login.body.data.user.projectIds[0]
const startedAt = Date.now()

const results = await Promise.all(
  Array.from({ length: concurrency }, async (_, index) => {
    const workspace = await requestJson<ApiEnvelope<WorkspaceSummary>>("/api/workspace/create", {
      method: "POST",
      body: {
        projectId,
        name: `bench-${Date.now()}-${index}`,
      },
    })
    assert(workspace.status === 200, `workspace/create failed at ${index}`)
    const session = await requestJson<ApiEnvelope<SessionSummary>>("/api/session/create", {
      method: "POST",
      body: {
        title: `Bench ${Date.now()}-${index}`,
        projectId,
        workspaceId: workspace.body.data.id,
      },
    })
    assert(session.status === 200, `session/create failed at ${index}`)
    const open = await requestJson<ApiEnvelope<SessionSummary>>("/api/acp/session/open", {
      method: "POST",
      body: { businessSessionId: session.body.data.id },
    })
    assert(open.status === 200, `session/open failed at ${index}`)
    return session.body.data.id
  }),
)

console.log(JSON.stringify({
  ok: true,
  concurrency,
  elapsedMs: Date.now() - startedAt,
  sessionCount: results.length,
}))

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
