import { cleanupWorkspacePrefixBestEffort } from "./test-workspace-cleanup"

export {}

const baseUrl = process.env.RUNTIME_SHELL_SMOKE_BASE_URL || "http://127.0.0.1:3100"
const username = process.env.RUNTIME_SHELL_SMOKE_USERNAME || "admin"
const password = process.env.RUNTIME_SHELL_SMOKE_PASSWORD || "change-me"
const concurrency = Number(process.env.RUNTIME_SHELL_CAPACITY_CONCURRENCY || "3")
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
  status: string
}

type WorkerSummary = {
  id: string
  resourceSummary?: {
    cpuPercent?: number
    memoryBytes?: number
    diskBytes?: number
  }
}

await requestJson<ApiEnvelope<{ user: { projectIds: string[] } }>>("/api/auth/login", {
  method: "POST",
  body: { username, password },
})

const me = await requestJson<ApiEnvelope<{ user: { projectIds: string[] } }>>("/api/auth/me")
assert(me.status === 200 && me.body.data.user.projectIds.length > 0, "auth/me failed")
const projectId = me.body.data.user.projectIds[0]
const namePrefix = `sandbox-capacity-${Date.now()}`

try {
  const sessionIds = await Promise.all(
    Array.from({ length: concurrency }, async (_, index) => {
      const workspace = await requestJson<ApiEnvelope<WorkspaceSummary>>("/api/workspace/create", {
        method: "POST",
        body: {
          projectId,
          name: `${namePrefix}-${index}`,
        },
      })
      assert(workspace.status === 200, `workspace/create failed at ${index}`)
      const session = await requestJson<ApiEnvelope<SessionSummary>>("/api/session/create", {
        method: "POST",
        body: {
          title: `Sandbox Capacity ${Date.now()}-${index}`,
          projectId,
          workspaceId: workspace.body.data.id,
        },
      })
      assert(session.status === 200, `session/create failed at ${index}`)
      const openResult = await requestJson<ApiEnvelope<SessionSummary>>("/api/acp/session/open", {
        method: "POST",
        body: { businessSessionId: session.body.data.id },
      })
      assert(openResult.status === 200, `session/open failed at ${index}`)
      return session.body.data.id
    }),
  )

  await Bun.sleep(1500)

  const workers = await requestJson<ApiEnvelope<{ items: WorkerSummary[] }>>("/api/worker/list")
  assert(workers.status === 200 && workers.body.data.items.length > 0, "worker/list failed")
  assert(
    workers.body.data.items.some((item) =>
      typeof item.resourceSummary?.cpuPercent === "number" &&
      typeof item.resourceSummary?.memoryBytes === "number" &&
      typeof item.resourceSummary?.diskBytes === "number"),
    "worker resource summary is incomplete",
  )

  const sandboxes = await requestJson<ApiEnvelope<{ summary: Record<string, number> }>>("/api/system/sandboxes?limit=200")
  assert(sandboxes.status === 200, "system/sandboxes failed")
  assert((sandboxes.body.data.summary.running || 0) >= 1, "running sandbox summary should be present")

  const queues = await requestJson<ApiEnvelope<{ items: Array<{ status: string }> }>>("/api/system/queues?limit=200")
  assert(queues.status === 200, "system/queues failed")

  await Promise.all(sessionIds.map(async (businessSessionId) => {
    const closeResult = await requestJson<ApiEnvelope<SessionSummary>>("/api/session/close", {
      method: "POST",
      body: { businessSessionId },
    })
    assert(closeResult.status === 200, `session/close failed for ${businessSessionId}`)
  }))

  console.log(JSON.stringify({
    ok: true,
    concurrency,
    sessionCount: sessionIds.length,
    runningSummary: sandboxes.body.data.summary.running || 0,
    queueItemCount: queues.body.data.items.length,
  }))
} finally {
  await cleanupWorkspacePrefixBestEffort({
    baseUrl,
    cookieJar,
    namePrefix,
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
