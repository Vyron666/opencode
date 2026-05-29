const baseUrl = process.env.RUNTIME_SHELL_GOVERNANCE_BASE_URL || "http://127.0.0.1:3100"
const username = process.env.RUNTIME_SHELL_GOVERNANCE_USERNAME || "admin"
const password = process.env.RUNTIME_SHELL_GOVERNANCE_PASSWORD || "change-me"
const leaseRenewWaitMs = Number(process.env.RUNTIME_SHELL_GOVERNANCE_LEASE_RENEW_WAIT_MS || "35000")
const governanceWaitMs = Number(process.env.RUNTIME_SHELL_GOVERNANCE_TICK_WAIT_MS || "55000")

type ApiEnvelope<T> = {
  code: number
  message: string
  data: T
  requestId: string
}

type SessionDetail = {
  id: string
  projectId: string
  workerId: string
  status: string
  runtimeHint?: {
    bindingStatus?: string
    hasLease?: boolean
    leaseExpiresAt?: string
    recoverable?: boolean
    lastFailure?: {
      failureType?: string
      message?: string
    } | null
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

const workspace = await requestJson<ApiEnvelope<{ id: string; projectId: string }>>("/api/workspace/create", {
  method: "POST",
  body: {
    projectId,
    name: `governance-${Date.now()}`,
  },
})
assert(workspace.status === 200, "workspace/create failed")

const session = await requestJson<ApiEnvelope<{ id: string }>>("/api/session/create", {
  method: "POST",
  body: {
    title: `Governance ${Date.now()}`,
    projectId,
    workspaceId: workspace.body.data.id,
  },
})
assert(session.status === 200, "session/create failed")

const businessSessionId = session.body.data.id

const open = await requestJson<ApiEnvelope<SessionDetail>>("/api/acp/session/open", {
  method: "POST",
  body: { businessSessionId },
})
assert(open.status === 200, "session/open failed")

const initialLease = await requestJson<ApiEnvelope<{ session: SessionDetail; lease: { leaseExpiresAt: string } | null }>>(
  `/api/runtime-governance/lease/detail?businessSessionId=${encodeURIComponent(businessSessionId)}`,
)
assert(initialLease.status === 200 && initialLease.body.data.lease?.leaseExpiresAt, "initial lease detail failed")

await Bun.sleep(leaseRenewWaitMs)

const renewedLease = await requestJson<ApiEnvelope<{ session: SessionDetail; lease: { leaseExpiresAt: string } | null }>>(
  `/api/runtime-governance/lease/detail?businessSessionId=${encodeURIComponent(businessSessionId)}`,
)
assert(renewedLease.status === 200 && renewedLease.body.data.lease?.leaseExpiresAt, "renewed lease detail failed")
assert(
  new Date(renewedLease.body.data.lease.leaseExpiresAt).getTime() >
    new Date(initialLease.body.data.lease.leaseExpiresAt).getTime(),
  `lease should auto renew while runtime stays open: initial=${initialLease.body.data.lease.leaseExpiresAt} renewed=${renewedLease.body.data.lease.leaseExpiresAt}`,
)

const failedWorkerId = renewedLease.body.data.session.workerId
const failedWorkerContainer = readWorkerContainerName(failedWorkerId)
await stopWorkerContainer(failedWorkerContainer)
await Bun.sleep(governanceWaitMs)

let orphanedDetail: SessionDetail | null = null
let failureDetail:
  | ApiEnvelope<{
      session: SessionDetail
      failures: Array<{ failureType: string; message?: string }>
    }>
  | null = null
let heartbeatDetail:
  | ApiEnvelope<{
      worker: { id: string; status: string }
      heartbeats: Array<{ workerId: string; status: string }>
    }>
  | null = null
let recoveredDetail: SessionDetail | null = null
let closeStatus: number | null = null

try {
  orphanedDetail = await waitForSessionDetail(
    businessSessionId,
    (detail) => detail.status === "orphaned" && detail.runtimeHint?.recoverable === true,
    "session should become orphaned after worker heartbeat timeout",
  )
  assert(orphanedDetail.runtimeHint?.bindingStatus === "lost", "orphaned session should mark binding lost")

  const failureResponse = await requestJson<
    ApiEnvelope<{
      session: SessionDetail
      failures: Array<{ failureType: string; message?: string }>
    }>
  >(`/api/runtime-governance/failure/detail?businessSessionId=${encodeURIComponent(businessSessionId)}`)
  assert(failureResponse.status === 200, "failure/detail failed")
  assert(
    failureResponse.body.data.failures.some((item) => item.failureType === "worker_offline"),
    "worker_offline failure should be recorded",
  )
  failureDetail = failureResponse.body

  const heartbeatResponse = await requestJson<
    ApiEnvelope<{
      worker: { id: string; status: string }
      heartbeats: Array<{ workerId: string; status: string }>
    }>
  >(`/api/runtime-governance/heartbeat/detail?workerId=${encodeURIComponent(failedWorkerId)}`)
  assert(heartbeatResponse.status === 200, "heartbeat/detail failed")
  assert(heartbeatResponse.body.data.heartbeats.length > 0, "heartbeat/detail should contain records")
  heartbeatDetail = heartbeatResponse.body

  const reopen = await requestJson<ApiEnvelope<SessionDetail>>("/api/acp/session/open", {
    method: "POST",
    body: { businessSessionId },
  })
  assert(reopen.status === 200, "transparent reopen failed")

  recoveredDetail = await waitForSessionDetail(
    businessSessionId,
    (detail) => detail.status === "active" && detail.runtimeHint?.hasLease === true,
    "session should recover to active after reopen",
  )
  assert(recoveredDetail.workerId !== failedWorkerId, "session should recover onto another ready worker")
  const close = await requestJson<ApiEnvelope<SessionDetail>>("/api/session/close", {
    method: "POST",
    body: { businessSessionId },
  })
  assert(close.status === 200, "recovered session close failed")
  closeStatus = close.status
} finally {
  await startWorkerContainer(failedWorkerContainer)
}

console.log(
  JSON.stringify({
    ok: true,
    baseUrl,
    businessSessionId,
    failedWorkerId,
    failedWorkerContainer,
    initialLeaseExpiresAt: initialLease.body.data.lease.leaseExpiresAt,
    renewedLeaseExpiresAt: renewedLease.body.data.lease.leaseExpiresAt,
    failureTypes: failureDetail?.data.failures.map((item) => item.failureType),
    heartbeatCount: heartbeatDetail?.data.heartbeats.length,
    orphanedStatus: orphanedDetail?.status,
    finalStatus: recoveredDetail?.status,
    finalWorkerId: recoveredDetail?.workerId,
    finalBindingStatus: recoveredDetail?.runtimeHint?.bindingStatus,
    closeStatus,
  }),
)

async function waitForSessionDetail(sessionId: string, predicate: (detail: SessionDetail) => boolean, message: string) {
  let latest: SessionDetail | null = null
  const startedAt = Date.now()
  while (Date.now() - startedAt < 45000) {
    const detail = await requestJson<ApiEnvelope<{ session: SessionDetail }>>(
      `/api/session/detail?businessSessionId=${encodeURIComponent(sessionId)}`,
    )
    assert(detail.status === 200, `session/detail failed for ${sessionId}`)
    latest = detail.body.data.session
    if (predicate(latest)) return latest
    await Bun.sleep(500)
  }
  throw new Error(`${message}: ${JSON.stringify(latest)}`)
}

async function stopWorkerContainer(containerName: string) {
  await runDockerCommand(["stop", containerName], `stop worker container failed: ${containerName}`)
}

async function startWorkerContainer(containerName: string) {
  await runDockerCommand(["start", containerName], `start worker container failed: ${containerName}`)
  await Bun.sleep(5000)
}

async function runDockerCommand(args: string[], message: string) {
  const child = Bun.spawn(["docker", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode === 0) return stdout
  throw new Error(`${message}: ${stderr || stdout}`)
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

function readWorkerContainerName(workerId: string) {
  if (workerId === "worker_local") return "opencode-worker"
  if (!workerId.startsWith("worker_local_")) throw new Error(`unsupported local worker id: ${workerId}`)
  return `opencode-worker-${workerId.replace("worker_local_", "")}`
}
