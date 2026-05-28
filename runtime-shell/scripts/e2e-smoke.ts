const baseUrl = process.env.RUNTIME_SHELL_SMOKE_BASE_URL || "http://127.0.0.1:3100"
const username = process.env.RUNTIME_SHELL_SMOKE_USERNAME || "admin"
const password = process.env.RUNTIME_SHELL_SMOKE_PASSWORD || "change-me"

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

const cookieJar: string[] = []

const login = await requestJson<ApiEnvelope<{ user: { username: string; projectIds: string[] } }>>("/api/auth/login", {
  method: "POST",
  body: {
    username,
    password,
  },
})
assert(login.status === 200 && login.body.code === 0, `login failed: ${login.status}`)

const me = await requestJson<ApiEnvelope<{ user: { username: string; projectIds: string[] } }>>("/api/auth/me")
assert(me.status === 200 && me.body.data.user.username === username, "auth/me mismatch")
assert(me.body.data.user.projectIds.length > 0, "auth/me returned no project scope")

const list = await requestJson<ApiEnvelope<{ items: SessionSummary[]; workspaces: WorkspaceSummary[] }>>("/api/session/list")
assert(list.status === 200, "session/list failed")

// 中文/English: workspaces are user-created now, so smoke must create an owned workspace first.
const workspace = await requestJson<ApiEnvelope<WorkspaceSummary>>("/api/workspace/create", {
  method: "POST",
  body: {
    projectId: me.body.data.user.projectIds[0],
    name: `smoke-${Date.now()}`,
  },
})
assert(workspace.status === 200 && workspace.body.data.id, "workspace/create failed")

const session = await requestJson<ApiEnvelope<SessionSummary>>("/api/session/create", {
  method: "POST",
  body: {
    title: `Smoke ${Date.now()}`,
    projectId: workspace.body.data.projectId,
    workspaceId: workspace.body.data.id,
  },
})
assert(session.status === 200 && session.body.data.id, "session/create failed")

const businessSessionId = session.body.data.id
const open = await requestJson<ApiEnvelope<SessionSummary>>("/api/acp/session/open", {
  method: "POST",
  body: { businessSessionId },
})
assert(open.status === 200 && open.body.data.status === "active", "session/open failed")

const input = await requestJson<ApiEnvelope<{ accepted: boolean }>>("/api/acp/session/input", {
  method: "POST",
  body: {
    businessSessionId,
    parts: [{ type: "text", text: "请用一句话回复：smoke ok" }],
  },
})
assert(input.status === 200 && input.body.data.accepted, "session/input failed")

await Bun.sleep(1500)

const detail = await requestJson<ApiEnvelope<{ session: SessionSummary; events: Array<{ eventType: string }> }>>(
  `/api/session/detail?businessSessionId=${businessSessionId}`,
)
assert(detail.status === 200 && detail.body.data.events.length > 0, "session/detail returned no events")

const idleCancel = await requestJson<ApiEnvelope<{ success: boolean }>>("/api/acp/session/cancel", {
  method: "POST",
  body: { businessSessionId },
})
assert(
  idleCancel.status === 409 || (idleCancel.status === 200 && idleCancel.body.data.success),
  `session/cancel returned unexpected status: ${idleCancel.status}`,
)

const close = await requestJson<ApiEnvelope<SessionSummary>>("/api/session/close", {
  method: "POST",
  body: { businessSessionId },
})
assert(close.status === 200 && close.body.data.status === "completed", "session/close failed")

console.log(
  JSON.stringify({
    ok: true,
    baseUrl,
    businessSessionId,
    workspaceId: workspace.body.data.id,
    detailEventCount: detail.body.data.events.length,
    idleCancelStatus: idleCancel.status,
    closeStatus: close.body.data.status,
  }),
)

async function requestJson<T>(
  path: string,
  init: {
    method?: string
    body?: unknown
  } = {},
) {
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
