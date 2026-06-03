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

type SessionSummary = {
  id: string
  status: string
}

type WorkspaceSummary = {
  id: string
  projectId: string
}

type SandboxSummary = {
  id: string
  businessSessionId: string
  status: string
  detail?: Record<string, unknown>
}

type SandboxOverview = {
  items: SandboxSummary[]
  summary: Record<string, number>
}

const login = await requestJson<ApiEnvelope<{ user: { username: string; projectIds: string[] } }>>("/api/auth/login", {
  method: "POST",
  body: { username, password },
})
assert(login.status === 200 && login.body.code === 0, "login failed")

const workspace = await requestJson<ApiEnvelope<WorkspaceSummary>>("/api/workspace/create", {
  method: "POST",
  body: {
    projectId: login.body.data.user.projectIds[0],
    name: `warm-pool-${Date.now()}`,
  },
})
assert(workspace.status === 200 && workspace.body.data.id, "workspace/create failed")

const session = await requestJson<ApiEnvelope<SessionSummary>>("/api/session/create", {
  method: "POST",
  body: {
    title: `Warm Pool ${Date.now()}`,
    projectId: workspace.body.data.projectId,
    workspaceId: workspace.body.data.id,
  },
})
assert(session.status === 200 && session.body.data.id, "session/create failed")

const openResult = await requestJson<ApiEnvelope<SessionSummary>>("/api/acp/session/open", {
  method: "POST",
  body: { businessSessionId: session.body.data.id },
})
assert(openResult.status === 200, "session/open failed")

await Bun.sleep(1500)

const sandboxes = await requestJson<ApiEnvelope<SandboxOverview>>("/api/system/sandboxes?limit=200")
assert(sandboxes.status === 200, "system/sandboxes failed")
const runningSandbox = sandboxes.body.data.items.find((item) => item.businessSessionId === session.body.data.id)
assert(Boolean(runningSandbox), "running sandbox not found after open")

const closeResult = await requestJson<ApiEnvelope<{ sandboxId: string; mode: string }>>(`/api/system/sandbox/${runningSandbox!.id}/close`, {
  method: "POST",
})
assert(closeResult.status === 200, "system sandbox close failed")

await Bun.sleep(1000)

const sandboxesAfterClose = await requestJson<ApiEnvelope<SandboxOverview>>("/api/system/sandboxes?limit=200")
assert(sandboxesAfterClose.status === 200, "system/sandboxes reload failed")
const sessionSandboxAfterClose = sandboxesAfterClose.body.data.items.find((item) => item.businessSessionId === session.body.data.id)
assert(!sessionSandboxAfterClose || sessionSandboxAfterClose.status === "closed", "sandbox close did not converge")

const sessionClose = await requestJson<ApiEnvelope<{ status: string }>>("/api/session/close", {
  method: "POST",
  body: { businessSessionId: session.body.data.id },
})
assert(sessionClose.status === 200, "session/close after system close failed")

console.log(JSON.stringify({
  ok: true,
  businessSessionId: session.body.data.id,
  sandboxId: runningSandbox!.id,
  mode: closeResult.body.data.mode,
  sessionCloseStatus: sessionClose.status,
  summary: sandboxesAfterClose.body.data.summary,
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
