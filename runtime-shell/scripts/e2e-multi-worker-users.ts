const baseUrl = process.env.RUNTIME_SHELL_MULTI_WORKER_BASE_URL || "http://127.0.0.1:3100"

type CookieJar = {
  cookie: string
}

type ApiEnvelope<T> = {
  code: number
  message: string
  data: T
  requestId: string
}

type WorkerSummary = {
  id: string
  workerCode: string
  name: string
  status: string
  activeSessionCount: number
}

type SessionSummary = {
  id: string
  title: string
  status: string
  workerId: string
  capabilities?: {
    close?: boolean
  }
}

const adminJar = createJar()
const developerJar = createJar()
const developerSecondaryJar = createJar()

await login(adminJar, "admin", "change-me")
await login(developerJar, "developer", "change-me")
await login(developerSecondaryJar, "developer-secondary", "change-me")

const workers = await requestJson<ApiEnvelope<{ items: WorkerSummary[] }>>(adminJar, "/api/worker/list")
assert(workers.status === 200, "worker list failed")
const localWorkers = workers.body.data.items
  .filter((item) => item.workerCode.startsWith("worker_local"))
  .sort((left, right) => left.workerCode.localeCompare(right.workerCode))
assert(localWorkers.length >= 2, "expected at least two local workers")
const routeTargets = localWorkers.slice(0, Math.min(localWorkers.length, 3))
assert(routeTargets.length >= 2, "expected at least two local worker ids")

await cleanupOwnedTestSessions(adminJar, ["multi-admin-", "dbg-"])
await cleanupOwnedTestSessions(developerJar, ["multi-dev-", "dbg-"])
await cleanupOwnedTestSessions(developerSecondaryJar, ["multi-dev2-", "dbg-"])
await Bun.sleep(1200)

const adminScope = await requestJson<ApiEnvelope<{ items: SessionSummary[]; workspaces: Array<{ id: string; projectId: string }> }>>(adminJar, "/api/session/list")
const developerScope = await requestJson<ApiEnvelope<{ items: SessionSummary[]; workspaces: Array<{ id: string; projectId: string }> }>>(developerJar, "/api/session/list")
const developerSecondaryScope = await requestJson<ApiEnvelope<{ items: SessionSummary[]; workspaces: Array<{ id: string; projectId: string }> }>>(developerSecondaryJar, "/api/session/list")

const adminWorkspace = adminScope.body.data.workspaces[0]
const developerWorkspace = developerScope.body.data.workspaces[0]
const developerSecondaryWorkspace = developerSecondaryScope.body.data.workspaces[0]
assert(adminWorkspace && developerWorkspace && developerSecondaryWorkspace, "missing workspace scope for multi-user test")

await setOnlyReadyWorkers(adminJar, [routeTargets.at(-1)!.id])
const createdAdmin = await createSession(adminJar, adminWorkspace.projectId, adminWorkspace.id, "multi-admin")
assert(
  createdAdmin.workerId === routeTargets.at(-1)!.id,
  `admin session should route to ${routeTargets.at(-1)!.workerCode}: ${JSON.stringify(createdAdmin)}`,
)

await setOnlyReadyWorkers(adminJar, [routeTargets[0].id])
const createdDeveloper = await createSession(developerJar, developerWorkspace.projectId, developerWorkspace.id, "multi-dev")
assert(
  createdDeveloper.workerId === routeTargets[0].id,
  `developer session should route to ${routeTargets[0].workerCode}: ${JSON.stringify(createdDeveloper)}`,
)

const developerSecondaryTarget = routeTargets[1]?.id || routeTargets[0].id
await setOnlyReadyWorkers(adminJar, [developerSecondaryTarget])
const createdDeveloperSecondary = await createSession(
  developerSecondaryJar,
  developerSecondaryWorkspace.projectId,
  developerSecondaryWorkspace.id,
  "multi-dev2",
)
assert(
  createdDeveloperSecondary.workerId === developerSecondaryTarget,
  `developer-secondary session should route to ${developerSecondaryTarget}: ${JSON.stringify(createdDeveloperSecondary)}`,
)

const created = [createdAdmin, createdDeveloper, createdDeveloperSecondary]
const initialWorkerSpread = [...new Set([createdAdmin.workerId, createdDeveloper.workerId, createdDeveloperSecondary.workerId])]
const expectedSpread = routeTargets.length >= 3 ? 3 : 2
assert(initialWorkerSpread.length >= expectedSpread, `sessions should cover ${expectedSpread} workers: ${JSON.stringify(created)}`)

await setOnlyReadyWorkers(adminJar, routeTargets.map((worker) => worker.id))

await Promise.all([
  openSession(adminJar, created[0].id),
  openSession(developerJar, created[1].id),
  openSession(developerSecondaryJar, created[2].id),
])

const activeSessions = await Promise.all([
  waitForSession(adminJar, created[0].id, (session) => session.status === "active"),
  waitForSession(developerJar, created[1].id, (session) => session.status === "active"),
  waitForSession(developerSecondaryJar, created[2].id, (session) => session.status === "active"),
])

const failoverSource = activeSessions.find((session) => session.workerId === routeTargets[0].id) || activeSessions[0]
const failoverTargetWorkerIds = routeTargets
  .map((worker) => worker.id)
  .filter((workerId) => workerId !== failoverSource.workerId)
assert(failoverTargetWorkerIds.length >= 1, "expected at least one failover target worker")

await reportWorkerStatus(adminJar, failoverSource.workerId, "offline")
const reopened = await requestJson<ApiEnvelope<SessionSummary>>(adminJar, "/api/acp/session/open", {
  method: "POST",
  body: { businessSessionId: failoverSource.id },
})
assert(reopened.status === 200, "reopen after worker offline failed")

const failedOverSession = await waitForSession(
  adminJar,
  failoverSource.id,
  (session) => session.status === "active" && failoverTargetWorkerIds.includes(session.workerId),
)

await reportWorkerStatus(adminJar, failoverSource.workerId, "ready")

await closeSession(adminJar, createdAdmin.id)
await closeSession(developerJar, createdDeveloper.id)
await closeSession(developerSecondaryJar, createdDeveloperSecondary.id)

const finalWorkers = await requestJson<ApiEnvelope<{ items: WorkerSummary[] }>>(adminJar, "/api/worker/list")
assert(finalWorkers.status === 200, "worker list refresh failed")

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  workerIds: localWorkers.map((item) => item.id),
  createdSessionIds: created.map((item) => item.id),
  initialWorkerSpread,
  failover: {
    sessionId: failedOverSession.id,
    fromWorkerId: failoverSource.workerId,
    toWorkerId: failedOverSession.workerId,
  },
  finalWorkerStates: finalWorkers.body.data.items
    .filter((item) => item.workerCode.startsWith("worker_local"))
    .map((item) => ({
      id: item.id,
      status: item.status,
      activeSessionCount: item.activeSessionCount,
    })),
}, null, 2))

async function createSession(jar: CookieJar, projectId: string, workspaceId: string, titlePrefix: string) {
  const response = await requestJson<ApiEnvelope<SessionSummary>>(jar, "/api/session/create", {
    method: "POST",
    body: {
      title: `${titlePrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      projectId,
      workspaceId,
    },
  })
  assert(response.status === 200, `create session failed: ${titlePrefix}`)
  return response.body.data
}

async function openSession(jar: CookieJar, businessSessionId: string) {
  const response = await requestJson<ApiEnvelope<SessionSummary>>(jar, "/api/acp/session/open", {
    method: "POST",
    body: { businessSessionId },
  })
  assert(response.status === 200, `open session failed: ${businessSessionId}`)
  return response.body.data
}

async function reportWorkerStatus(jar: CookieJar, workerNodeId: string, status: "ready" | "offline") {
  const response = await requestJson<ApiEnvelope<{ worker: WorkerSummary }>>(jar, "/api/worker/heartbeat", {
    method: "POST",
    body: {
      workerNodeId,
      capacityUsed: 0,
      status,
    },
  })
  assert(response.status === 200, `worker heartbeat failed: ${workerNodeId} -> ${status}`)
}

async function closeSession(jar: CookieJar, businessSessionId: string) {
  const response = await requestJson<ApiEnvelope<SessionSummary>>(jar, "/api/session/close", {
    method: "POST",
    body: { businessSessionId },
  })
  assert(response.status === 200, `close session failed: ${businessSessionId}`)
}

async function cleanupOwnedTestSessions(jar: CookieJar, titlePrefixes: string[]) {
  const response = await requestJson<ApiEnvelope<{ items: SessionSummary[] }>>(jar, "/api/session/list")
  assert(response.status === 200, "session list failed during cleanup")
  const ownedTestSessions = response.body.data.items.filter(
    (session) =>
      session.status !== "completed" &&
      session.capabilities?.close === true &&
      titlePrefixes.some((prefix) => session.title.startsWith(prefix)),
  )
  await Promise.all(ownedTestSessions.map((session) => closeSession(jar, session.id)))
}

async function setOnlyReadyWorkers(jar: CookieJar, readyWorkerIds: string[]) {
  await Promise.all(
    localWorkers.map((worker) =>
      reportWorkerStatus(jar, worker.id, readyWorkerIds.includes(worker.id) ? "ready" : "offline"),
    ),
  )
}

async function waitForSession(jar: CookieJar, businessSessionId: string, predicate: (session: SessionSummary) => boolean) {
  let latest: SessionSummary | undefined
  const startedAt = Date.now()
  while (Date.now() - startedAt < 20000) {
    const detail = await requestJson<ApiEnvelope<{ session: SessionSummary }>>(
      jar,
      `/api/session/detail?businessSessionId=${encodeURIComponent(businessSessionId)}`,
    )
    assert(detail.status === 200, `session detail failed: ${businessSessionId}`)
    latest = detail.body.data.session
    if (predicate(latest)) return latest
    await Bun.sleep(400)
  }
  throw new Error(`session did not converge: ${businessSessionId} latest=${JSON.stringify(latest)}`)
}

async function login(jar: CookieJar, username: string, password: string) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ username, password }),
    redirect: "manual",
  })
  const cookie = response.headers.get("set-cookie") || ""
  assert(response.status === 200 && cookie, `login failed: ${username}`)
  jar.cookie = cookie.split(";")[0]
}

async function requestJson<T>(jar: CookieJar, path: string, init?: { method?: string; body?: unknown }) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: init?.method || "GET",
    headers: {
      cookie: jar.cookie,
      ...(init?.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const text = await response.text()
  let body: T
  try {
    body = JSON.parse(text) as T
  } catch {
    throw new Error(`non-json response: ${path} status=${response.status} body=${text}`)
  }
  return {
    status: response.status,
    body,
  }
}

function createJar(): CookieJar {
  return { cookie: "" }
}

function assert(condition: unknown, message: string): asserts condition {
  if (condition) return
  throw new Error(message)
}
