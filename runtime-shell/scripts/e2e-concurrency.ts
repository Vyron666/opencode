const baseUrl = process.env.RUNTIME_SHELL_CONCURRENCY_BASE_URL || "http://127.0.0.1:3100"
const username = process.env.RUNTIME_SHELL_CONCURRENCY_USERNAME || "admin"
const password = process.env.RUNTIME_SHELL_CONCURRENCY_PASSWORD || "change-me"

type ApiEnvelope<T> = {
  code: number
  message: string
  data: T
  requestId: string
}

type SessionDetail = {
  id: string
  status: string
  runtimeHint?: {
    bindingStatus?: string
    hasLease?: boolean
  }
}

const cookieJar: string[] = []

const login = await requestJson<ApiEnvelope<{ user: { projectIds: string[] } }>>("/api/auth/login", {
  method: "POST",
  body: {
    username,
    password,
  },
})
assert(login.status === 200, "login failed")

const projectId = login.body.data.user.projectIds[0]
assert(projectId, "admin project scope missing")

const workspace = await requestJson<ApiEnvelope<{ id: string }>>("/api/workspace/create", {
  method: "POST",
  body: {
    projectId,
    name: `concurrency-${Date.now()}`,
  },
})
assert(workspace.status === 200, "workspace/create failed")

const session = await requestJson<ApiEnvelope<{ id: string }>>("/api/session/create", {
  method: "POST",
  body: {
    title: `Concurrency ${Date.now()}`,
    projectId,
    workspaceId: workspace.body.data.id,
  },
})
assert(session.status === 200, "session/create failed")

const businessSessionId = session.body.data.id

const openResults = await Promise.all(
  Array.from({ length: 3 }, () =>
    requestJson<ApiEnvelope<SessionDetail>>("/api/acp/session/open", {
      method: "POST",
      body: { businessSessionId },
    }),
  ),
)
assert(openResults.every((item) => item.status === 200), "parallel open should not fail")

const activeDetail = await waitForSessionDetail(
  businessSessionId,
  (detail) => detail.status === "active" && detail.runtimeHint?.bindingStatus === "bound",
  "session should converge to active after parallel open",
)

const reopenResults = await Promise.all(
  ["/api/acp/session/open", "/api/acp/session/load", "/api/acp/session/resume"].map((path) =>
    requestJson<ApiEnvelope<SessionDetail>>(path, {
      method: "POST",
      body: { businessSessionId },
    }),
  ),
)
assert(reopenResults.every((item) => item.status === 200), "parallel open/load/resume should not fail")

const promptResults = await Promise.all(
  Array.from({ length: 3 }, (_, index) =>
    requestJson<ApiEnvelope<{ accepted: boolean }>>("/api/acp/session/input", {
      method: "POST",
      body: {
        businessSessionId,
        parts: [{ type: "text", text: `并发测试 ${index + 1}` }],
      },
    }),
  ),
)
assert(promptResults.some((item) => item.status === 200), "at least one prompt should be accepted")
assert(promptResults.every((item) => item.status === 200 || item.status === 409), "parallel prompt should converge with 200/409 only")

await Bun.sleep(1500)

const cancelResults = await Promise.all(
  Array.from({ length: 3 }, () =>
    requestJson<ApiEnvelope<{ success: boolean }>>("/api/acp/session/cancel", {
      method: "POST",
      body: { businessSessionId },
    }),
  ),
)
assert(cancelResults.every((item) => item.status === 200 || item.status === 409), "parallel cancel should converge with 200/409 only")

const detail = await requestJson<ApiEnvelope<{ session: SessionDetail }>>(
  `/api/session/detail?businessSessionId=${encodeURIComponent(businessSessionId)}`,
)
assert(detail.status === 200, "session/detail failed")
assert(detail.body.data.session.runtimeHint?.hasLease === true, "active session should still hold a lease")

const close = await requestJson<ApiEnvelope<SessionDetail>>("/api/session/close", {
  method: "POST",
  body: { businessSessionId },
})
assert(close.status === 200, "session/close failed")

console.log(
  JSON.stringify({
    ok: true,
    baseUrl,
    businessSessionId,
    openStatuses: openResults.map((item) => item.status),
    reopenStatuses: reopenResults.map((item) => item.status),
    promptStatuses: promptResults.map((item) => item.status),
    cancelStatuses: cancelResults.map((item) => item.status),
    finalStatusBeforeClose: activeDetail.status,
    closeStatus: close.body.data.status,
  }),
)

async function waitForSessionDetail(sessionId: string, predicate: (detail: SessionDetail) => boolean, message: string) {
  let latest: SessionDetail | null = null
  const startedAt = Date.now()
  while (Date.now() - startedAt < 15000) {
    const detail = await requestJson<ApiEnvelope<{ session: SessionDetail }>>(
      `/api/session/detail?businessSessionId=${encodeURIComponent(sessionId)}`,
    )
    assert(detail.status === 200, `session/detail failed for ${sessionId}`)
    latest = detail.body.data.session
    if (predicate(latest)) return latest
    await Bun.sleep(300)
  }
  throw new Error(`${message}: ${JSON.stringify(latest)}`)
}

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
  const text = await response.text()
  return {
    status: response.status,
    body: JSON.parse(text) as T,
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
