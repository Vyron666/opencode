const baseUrl = process.env.RUNTIME_SHELL_WORKER_ROUTING_BASE_URL || "http://127.0.0.1:3100"
const username = process.env.RUNTIME_SHELL_WORKER_ROUTING_USERNAME || "admin"
const password = process.env.RUNTIME_SHELL_WORKER_ROUTING_PASSWORD || "change-me"

type ApiEnvelope<T> = {
  code: number
  message: string
  data: T
  requestId: string
}

const jar: string[] = []

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
const fakeWorkerCode = "worker_fake_e2e_routing"

const fakeWorker = await requestJson<ApiEnvelope<{ workerNodeId: string }>>("/api/worker/register", {
  method: "POST",
  body: {
    // 中文/English: reuse one stable fake worker code so repeated routing tests do not pollute worker history.
    nodeCode: fakeWorkerCode,
    endpoint: "http://127.0.0.1:59999",
    capacityTotal: 99,
    name: "fake-remote",
  },
})
assert(fakeWorker.status === 200, "worker/register failed")

const fakeWorkerId = fakeWorker.body.data.workerNodeId

const heartbeat = await requestJson<ApiEnvelope<{ worker: { id: string; status: string } }>>("/api/worker/heartbeat", {
  method: "POST",
  body: {
    workerNodeId: fakeWorkerId,
    capacityUsed: 0,
    status: "ready",
  },
})
assert(heartbeat.status === 200, "worker/heartbeat failed")

const workspace = await requestJson<ApiEnvelope<{ id: string; projectId: string }>>("/api/workspace/create", {
  method: "POST",
  body: {
    projectId,
    name: `worker-routing-${Date.now()}`,
  },
})
assert(workspace.status === 200, "workspace/create failed")

const session = await requestJson<ApiEnvelope<{ id: string }>>("/api/session/create", {
  method: "POST",
  body: {
    title: `Worker Routing ${Date.now()}`,
    projectId,
    workspaceId: workspace.body.data.id,
  },
})
assert(session.status === 200, "session/create failed")

const detail = await requestJson<ApiEnvelope<{ session: { workerId: string; status: string } }>>(
  `/api/session/detail?businessSessionId=${encodeURIComponent(session.body.data.id)}`,
)
assert(detail.status === 200, "session/detail failed")
assert(detail.body.data.session.workerId !== fakeWorkerId, "session should not bind to unsupported remote worker")

console.log(
  JSON.stringify({
    ok: true,
    baseUrl,
    fakeWorkerCode,
    fakeWorkerId,
    assignedWorkerId: detail.body.data.session.workerId,
    sessionStatus: detail.body.data.session.status,
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
      ...(jar.length ? { Cookie: jar.join("; ") } : {}),
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
