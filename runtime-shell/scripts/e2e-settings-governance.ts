const baseUrl = process.env.RUNTIME_SHELL_SETTINGS_GOVERNANCE_BASE_URL || "http://127.0.0.1:3100"
const adminUsername = process.env.RUNTIME_SHELL_SETTINGS_GOVERNANCE_ADMIN_USERNAME || "admin"
const developerUsername = process.env.RUNTIME_SHELL_SETTINGS_GOVERNANCE_DEVELOPER_USERNAME || "developer"
const password = process.env.RUNTIME_SHELL_SETTINGS_GOVERNANCE_PASSWORD || "change-me"

type ApiEnvelope<T> = {
  code: number
  message: string
  data: T
  requestId: string
}

const adminJar: string[] = []
const developerJar: string[] = []

const adminLogin = await login(adminJar, adminUsername)
await login(developerJar, developerUsername)

const providerConfigs = await requestJson<ApiEnvelope<{ items: Array<{ providerId: string }> }>>(adminJar, "/api/provider-config")
assert(providerConfigs.status === 200, "admin provider-config failed")
assert(providerConfigs.body.data.items.length > 0, "admin provider-config should not be empty on clean bootstrap")

const workspace = await requestJson<ApiEnvelope<{ id: string; projectId: string }>>(adminJar, "/api/workspace/create", {
  method: "POST",
  body: {
    projectId: adminLogin.projectIds[0],
    name: `settings-governance-${Date.now()}`,
  },
})
assert(workspace.status === 200, "workspace/create failed")

const session = await requestJson<ApiEnvelope<{ id: string }>>(adminJar, "/api/session/create", {
  method: "POST",
  body: {
    title: `Settings Governance ${Date.now()}`,
    projectId: workspace.body.data.projectId,
    workspaceId: workspace.body.data.id,
  },
})
assert(session.status === 200, "session/create failed")

const businessSessionId = session.body.data.id

const developerWorkerList = await requestJson<ApiEnvelope<{ items: unknown[] }>>(developerJar, "/api/worker/list")
const developerHeartbeatDetail = await requestJson<ApiEnvelope<{ worker: unknown }>>(
  developerJar,
  "/api/runtime-governance/heartbeat/detail?workerId=worker_local",
)
const developerLeaseDetail = await requestJson<ApiEnvelope<{ lease: unknown }>>(
  developerJar,
  `/api/runtime-governance/lease/detail?businessSessionId=${encodeURIComponent(businessSessionId)}`,
)
const developerFailureDetail = await requestJson<ApiEnvelope<{ failures: unknown[] }>>(
  developerJar,
  `/api/runtime-governance/failure/detail?businessSessionId=${encodeURIComponent(businessSessionId)}`,
)
const developerCleanup = await requestJson<ApiEnvelope<{ cleanedSessionIds: string[] }>>(developerJar, "/api/runtime-governance/cleanup", {
  method: "POST",
  body: {},
})
const missingSessionDetail = await requestJson<ApiEnvelope<{ session: unknown }>>(
  adminJar,
  "/api/session/detail?businessSessionId=missing-session",
)

assert(developerWorkerList.status === 403, "developer worker/list should be forbidden")
assert(developerHeartbeatDetail.status === 403, "developer heartbeat/detail should be forbidden")
assert(developerLeaseDetail.status === 403, "developer lease/detail should be forbidden")
assert(developerFailureDetail.status === 403, "developer failure/detail should be forbidden")
assert(developerCleanup.status === 403, "developer cleanup should be forbidden")
assert(missingSessionDetail.status === 404, "missing session detail should return 404")

console.log(
  JSON.stringify({
    ok: true,
    baseUrl,
    providerCount: providerConfigs.body.data.items.length,
    developerStatuses: {
      workerList: developerWorkerList.status,
      heartbeatDetail: developerHeartbeatDetail.status,
      leaseDetail: developerLeaseDetail.status,
      failureDetail: developerFailureDetail.status,
      cleanup: developerCleanup.status,
    },
    missingSessionDetailStatus: missingSessionDetail.status,
  }),
)

async function login(jar: string[], username: string) {
  const response = await requestJson<ApiEnvelope<{ user: { projectIds: string[] } }>>(jar, "/api/auth/login", {
    method: "POST",
    body: { username, password },
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
