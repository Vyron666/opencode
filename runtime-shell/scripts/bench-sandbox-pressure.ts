import { cleanupWorkspacePrefixBestEffort } from "./test-workspace-cleanup"

export {}

const baseUrl = process.env.RUNTIME_SHELL_PRESSURE_BASE_URL || "http://127.0.0.1:3100"
const username = process.env.RUNTIME_SHELL_PRESSURE_USERNAME || "admin"
const password = process.env.RUNTIME_SHELL_PRESSURE_PASSWORD || "change-me"
const concurrencyList = (process.env.RUNTIME_SHELL_PRESSURE_CONCURRENCY || "10,20,50")
  .split(",")
  .map((item) => Number(item.trim()))
  .filter((item) => Number.isFinite(item) && item > 0)
const openSettleTimeoutMs = Number(process.env.RUNTIME_SHELL_PRESSURE_OPEN_SETTLE_TIMEOUT_MS || "180000")
const pollIntervalMs = Number(process.env.RUNTIME_SHELL_PRESSURE_POLL_INTERVAL_MS || "1000")
const governanceWaitMs = Number(process.env.RUNTIME_SHELL_PRESSURE_GOVERNANCE_WAIT_MS || "70000")
const workerRestartWaitMs = Number(process.env.RUNTIME_SHELL_PRESSURE_WORKER_RESTART_WAIT_MS || "6000")
const systemLimit = Number(process.env.RUNTIME_SHELL_PRESSURE_SYSTEM_LIMIT || "5000")
const requestTimeoutMs = Number(process.env.RUNTIME_SHELL_PRESSURE_REQUEST_TIMEOUT_MS || "60000")
const skipRecoveryProbe = process.env.RUNTIME_SHELL_PRESSURE_SKIP_RECOVERY === "1"
const requestBodySnippetLimit = 400
const cookieJar: string[] = []

type ApiEnvelope<T> = {
  code: number
  message: string
  data: T
  requestId: string
}

type AuthUser = {
  id: string
  projectIds: string[]
}

type WorkspaceSummary = {
  id: string
  projectId: string
}

type SessionSummary = {
  id: string
  status: string
  workerId: string
  projectId: string
}

type SessionDetail = {
  id: string
  status: string
  workerId: string
  projectId: string
  runtimeHint?: {
    bindingStatus?: string
    hasLease?: boolean
    recoverable?: boolean
    lastFailure?: {
      failureType?: string
      message?: string
    } | null
  }
}

type WorkerSummary = {
  id: string
  workerCode: string
  name: string
  status: string
  capacity: number
  activeSessionCount: number
  warmPoolReady?: number
  warmPoolTarget?: number
  resourceSummary?: {
    runningSandboxCount: number
    warmSandboxCount: number
    queuedOperationCount: number
    cpuPercent?: number
    memoryBytes?: number
    diskBytes?: number
  }
}

type RuntimeOperation = {
  id: string
  businessSessionId?: string
  workerId?: string
  operationType: string
  status: string
  detail?: Record<string, unknown>
  createdAt: string
  startedAt?: string
  completedAt?: string
  errorMessage?: string
}

type SandboxInstance = {
  id: string
  businessSessionId: string
  workerId: string
  status: string
  createdAt: string
  openedAt?: string
  closedAt?: string
  detail?: Record<string, unknown>
}

type SystemQueuesResponse = {
  items: RuntimeOperation[]
}

type SystemSandboxesResponse = {
  items: SandboxInstance[]
  summary: Record<string, number>
}

type WorkerListResponse = {
  items: WorkerSummary[]
}

type FailureDetailResponse = {
  failures: Array<{
    failureType: string
    message?: string
  }>
}

type ScenarioSession = {
  index: number
  workspaceId?: string
  sessionId?: string
  createStartedAt: number
  createCompletedAt?: number
  createStatus?: number
  createError?: string
  openStartedAt?: number
  openCompletedAt?: number
  openStatus?: number
  openError?: string
  activeAt?: number
  terminalStatus?: string
  workerId?: string
}

type SystemSnapshot = {
  at: number
  queuedOperations: number
  runningOperations: number
  preparingSandboxes: number
  runningSandboxes: number
  workerLoads: Array<{
    id: string
    status: string
    activeSessionCount: number
    queuedOperationCount: number
    runningSandboxCount: number
    warmPoolReady?: number
  }>
}

const login = await requestJson<ApiEnvelope<{ user: AuthUser }>>("/api/auth/login", {
  method: "POST",
  body: { username, password },
})
assert(login.status === 200, "login failed")
const authUser = login.body.data.user
const projectId = authUser.projectIds[0]
assert(projectId, "admin project scope missing")

const baseline = await collectBaseline()
const scenarios = []

for (const concurrency of concurrencyList) {
  scenarios.push(await runPressureScenario(concurrency))
}

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  username,
  projectId,
  skipRecoveryProbe,
  requestTimeoutMs,
  openSettleTimeoutMs,
  baseline,
  scenarios,
}, null, 2))

async function runPressureScenario(concurrency: number) {
  const scenarioLabel = `pressure-${concurrency}-${Date.now()}`
  const sessions: ScenarioSession[] = Array.from({ length: concurrency }, (_, index) => ({
    index,
    createStartedAt: Date.now(),
  }))
  const scenarioStartedAt = Date.now()
  try {
    const creationResults = await Promise.all(
      sessions.map(async (session) => {
        try {
          const workspace = await requestJson<ApiEnvelope<WorkspaceSummary>>("/api/workspace/create", {
            method: "POST",
            body: {
              projectId,
              name: `${scenarioLabel}-workspace-${session.index}`,
            },
          })
          session.workspaceId = workspace.body.data.id
          const created = await requestJson<ApiEnvelope<SessionSummary>>("/api/session/create", {
            method: "POST",
            body: {
              title: `${scenarioLabel}-session-${session.index}`,
              projectId,
              workspaceId: workspace.body.data.id,
            },
          })
          session.createCompletedAt = Date.now()
          session.createStatus = created.status
          if (created.status === 200) {
            session.sessionId = created.body.data.id
            session.workerId = created.body.data.workerId || undefined
          } else {
            session.createError = created.body.message
          }
        } catch (error) {
          session.createCompletedAt = Date.now()
          session.createStatus = 0
          session.createError = error instanceof Error ? error.message : String(error)
        }
        return session
      }),
    )

    const createdSessions = creationResults.filter((session) => session.sessionId)
    const openResultsPromise = Promise.all(
      createdSessions.map(async (session) => {
        session.openStartedAt = Date.now()
        try {
          const open = await requestJson<ApiEnvelope<SessionSummary>>("/api/acp/session/open", {
            method: "POST",
            body: { businessSessionId: session.sessionId },
          })
          session.openCompletedAt = Date.now()
          session.openStatus = open.status
          if (open.status !== 200) session.openError = open.body.message
        } catch (error) {
          session.openCompletedAt = Date.now()
          session.openStatus = 0
          session.openError = error instanceof Error ? error.message : String(error)
        }
        return session
      }),
    )
    const systemSnapshotsPromise = waitForSessionConvergence(createdSessions, openSettleTimeoutMs)
    const openResults = await openResultsPromise

    const openableSessions = openResults.filter((session) => session.sessionId && session.openStatus === 200)
    const systemSnapshots = await systemSnapshotsPromise
    const queues = await requestJson<ApiEnvelope<SystemQueuesResponse>>(`/api/system/queues?limit=${systemLimit}`)
    const sandboxes = await requestJson<ApiEnvelope<SystemSandboxesResponse>>(`/api/system/sandboxes?limit=${systemLimit}`)
    const workers = await requestJson<ApiEnvelope<WorkerListResponse>>("/api/worker/list")
    const operationMetrics = buildOperationMetrics(openableSessions, queues.body.data.items)
    const sandboxMetrics = buildSandboxMetrics(openableSessions, sandboxes.body.data.items)
    const recovery = skipRecoveryProbe
      ? {
          skipped: true,
          concurrency,
          reason: "recovery_probe_disabled",
        }
      : await runRecoveryProbe(concurrency, openableSessions).catch((error) => ({
          skipped: true,
          concurrency,
          reason: "probe_failed",
          // 中文/English: recovery probe should never discard the pressure metrics that
          // were already collected successfully; record the probe failure separately.
          error: error instanceof Error ? error.message : String(error),
        }))

    return {
      concurrency,
      scenarioLabel,
      startedAt: new Date(scenarioStartedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      summary: buildScenarioSummary({
        sessions,
        operationMetrics,
        sandboxMetrics,
        systemSnapshots,
        workers: workers.body.data.items,
        sandboxes: sandboxes.body.data.summary,
      }),
      sessions: sessions.map((session) => ({
        index: session.index,
        sessionId: session.sessionId,
        workspaceId: session.workspaceId,
        createStatus: session.createStatus,
        openStatus: session.openStatus,
        terminalStatus: session.terminalStatus,
        workerId: session.workerId,
        createMs: duration(session.createStartedAt, session.createCompletedAt),
        openRequestMs: duration(session.openStartedAt, session.openCompletedAt),
        openToActiveMs: duration(session.openStartedAt, session.activeAt),
        createToActiveMs: duration(session.createStartedAt, session.activeAt),
        createError: session.createError,
        openError: session.openError,
        queueDelayMs: operationMetrics.bySessionId.get(session.sessionId || "")?.queueDelayMs,
        operationRunMs: operationMetrics.bySessionId.get(session.sessionId || "")?.runMs,
        operationTotalMs: operationMetrics.bySessionId.get(session.sessionId || "")?.totalMs,
        operationStage: operationMetrics.bySessionId.get(session.sessionId || "")?.stage,
        operationStageTimings: operationMetrics.bySessionId.get(session.sessionId || "")?.stageTimings,
        sandboxCreateToRunningMs: sandboxMetrics.bySessionId.get(session.sessionId || "")?.createToRunningMs,
      })),
      operationMetrics: {
        items: operationMetrics.items,
        stats: operationMetrics.stats,
      },
      sandboxMetrics: {
        items: sandboxMetrics.items,
        stats: sandboxMetrics.stats,
      },
      systemSnapshots,
      recovery,
    }
  } finally {
    await closeSessionsBestEffort(sessions.filter((session) => session.sessionId))
    await cleanupWorkspacePrefixBestEffort({
      baseUrl,
      cookieJar,
      namePrefix: concurrency === 10 ? "pressure-10-" : scenarioLabel,
      limit: systemLimit,
    })
  }
}

async function waitForSessionConvergence(sessions: ScenarioSession[], timeoutMs: number) {
  const snapshots: SystemSnapshot[] = []
  const pending = new Set(sessions.map((session) => session.sessionId).filter(Boolean) as string[])
  const startedAt = Date.now()
  while (pending.size > 0 && Date.now() - startedAt < timeoutMs) {
    for (const session of sessions) {
      if (!session.sessionId || session.openStatus === undefined || session.openStatus === 200) continue
      pending.delete(session.sessionId)
    }
    const pendingIds = [...pending]
    if (pendingIds.length === 0) break
    const details = await Promise.all(
      pendingIds.map((sessionId) =>
        requestJson<ApiEnvelope<{ session: SessionDetail }>>(
          `/api/session/detail?businessSessionId=${encodeURIComponent(sessionId)}`,
        ).catch(() => null),
      ),
    )
    details.forEach((detail, index) => {
      if (!detail || detail.status !== 200) return
      const sessionId = pendingIds[index]
      if (!sessionId) return
      const current = sessions.find((item) => item.sessionId === sessionId)
      if (!current) return
      current.terminalStatus = detail.body.data.session.status
      current.workerId = detail.body.data.session.workerId || current.workerId
      if (detail.body.data.session.status === "active" && !current.activeAt) {
        current.activeAt = Date.now()
      }
      if (detail.body.data.session.status === "active" || detail.body.data.session.status === "failed" || detail.body.data.session.status === "orphaned") {
        pending.delete(sessionId)
      }
    })
    snapshots.push(await captureSystemSnapshot())
    if (pending.size === 0) break
    await Bun.sleep(pollIntervalMs)
  }
  return snapshots
}

async function runRecoveryProbe(concurrency: number, sessions: ScenarioSession[]) {
  const activeSessions = sessions.filter((session) => session.sessionId && session.terminalStatus === "active" && session.workerId)
  if (activeSessions.length === 0) {
    return {
      skipped: true,
      reason: "no_active_session",
      concurrency,
    }
  }

  const workerUsage = activeSessions.reduce((usage, session) => {
    const workerId = session.workerId || ""
    usage.set(workerId, (usage.get(workerId) || 0) + 1)
    return usage
  }, new Map<string, number>())
  const targetWorkerId = [...workerUsage.entries()]
    .sort((left, right) => right[1] - left[1])[0]?.[0]
  if (!targetWorkerId) {
    return {
      skipped: true,
      reason: "no_target_worker",
      concurrency,
    }
  }

  const sampleSession = activeSessions.find((session) => session.workerId === targetWorkerId)
  if (!sampleSession?.sessionId) {
    return {
      skipped: true,
      reason: "no_target_session",
      concurrency,
    }
  }

  const failedWorkerContainer = readWorkerContainerName(targetWorkerId)
  const stopStartedAt = Date.now()
  let orphanedAt = 0
  let recoveredAt = 0
  let recoveredWorkerId = ""
  let failureTypes: string[] = []
  let reopenQueueDelayMs: number | undefined
  let reopenRunMs: number | undefined
  let reopenTotalMs: number | undefined

  await stopWorkerContainer(failedWorkerContainer)
  try {
    const orphaned = await waitForSessionState(sampleSession.sessionId, (detail) =>
      detail.status === "orphaned" && detail.runtimeHint?.bindingStatus === "lost",
    )
    orphanedAt = Date.now()

    const failureDetail = await requestJson<ApiEnvelope<FailureDetailResponse>>(
      `/api/runtime-governance/failure/detail?businessSessionId=${encodeURIComponent(sampleSession.sessionId)}`,
    )
    failureTypes = failureDetail.body.data.failures.map((item) => item.failureType)

    const reopenStartedAt = Date.now()
    const reopen = await requestJson<ApiEnvelope<SessionSummary>>("/api/acp/session/open", {
      method: "POST",
      body: { businessSessionId: sampleSession.sessionId },
    })
    assert(reopen.status === 200, `reopen failed during recovery probe: ${sampleSession.sessionId}`)

    const recovered = await waitForSessionState(sampleSession.sessionId, (detail) =>
      detail.status === "active" &&
      detail.runtimeHint?.hasLease === true &&
      detail.workerId !== targetWorkerId,
    )
    recoveredAt = Date.now()
    recoveredWorkerId = recovered.workerId

    const queues = await requestJson<ApiEnvelope<SystemQueuesResponse>>(`/api/system/queues?limit=${systemLimit}`)
    const reopenOperations = queues.body.data.items
      .filter((item) => item.businessSessionId === sampleSession.sessionId && item.operationType === "session_open")
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    const latestReopen = reopenOperations[0]
    reopenQueueDelayMs = readDuration(latestReopen?.createdAt, latestReopen?.startedAt)
    reopenRunMs = readDuration(latestReopen?.startedAt, latestReopen?.completedAt)
    reopenTotalMs = readDuration(latestReopen?.createdAt, latestReopen?.completedAt)

    return {
      skipped: false,
      concurrency,
      workerId: targetWorkerId,
      workerContainer: failedWorkerContainer,
      sessionId: sampleSession.sessionId,
      failureTypes,
      orphanedStatus: orphaned.status,
      recoveredStatus: recovered.status,
      recoveredWorkerId,
      orphanDetectMs: orphanedAt - stopStartedAt,
      reopenToActiveMs: recoveredAt - reopenStartedAt,
      reopenQueueDelayMs,
      reopenRunMs,
      reopenTotalMs,
    }
  } finally {
    await startWorkerContainer(failedWorkerContainer)
    await waitForWorkerReady(targetWorkerId)
  }
}

async function waitForSessionState(sessionId: string, predicate: (detail: SessionDetail) => boolean) {
  let latest: SessionDetail | null = null
  const startedAt = Date.now()
  while (Date.now() - startedAt < governanceWaitMs) {
    const detail = await requestJson<ApiEnvelope<{ session: SessionDetail }>>(
      `/api/session/detail?businessSessionId=${encodeURIComponent(sessionId)}`,
    )
    latest = detail.body.data.session
    if (predicate(latest)) return latest
    await Bun.sleep(500)
  }
  throw new Error(`session state wait timed out: ${sessionId} latest=${JSON.stringify(latest)}`)
}

async function waitForWorkerReady(workerId: string) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < governanceWaitMs) {
    const workers = await requestJson<ApiEnvelope<WorkerListResponse>>("/api/worker/list")
    const worker = workers.body.data.items.find((item) => item.id === workerId)
    if (worker?.status === "ready" || worker?.status === "busy") return worker
    await Bun.sleep(1000)
  }
  throw new Error(`worker did not recover after restart: ${workerId}`)
}

async function closeSessionsBestEffort(sessions: ScenarioSession[]) {
  await Promise.all(
    sessions
      .map((session) => session.sessionId)
      .filter((sessionId): sessionId is string => Boolean(sessionId))
      .map(async (businessSessionId) => {
        try {
          await requestJson<ApiEnvelope<SessionSummary>>("/api/session/close", {
            method: "POST",
            body: { businessSessionId },
          })
        } catch {
          return
        }
      }),
  )
}


async function collectBaseline() {
  const [workers, sandboxes, queues, quotas] = await Promise.all([
    requestJson<ApiEnvelope<WorkerListResponse>>("/api/worker/list"),
    requestJson<ApiEnvelope<SystemSandboxesResponse>>(`/api/system/sandboxes?limit=${systemLimit}`),
    requestJson<ApiEnvelope<SystemQueuesResponse>>(`/api/system/queues?limit=${systemLimit}`),
    requestJson<ApiEnvelope<{ items: Array<Record<string, unknown>> }>>("/api/system/quotas"),
  ])
  return {
    collectedAt: new Date().toISOString(),
    workerCount: workers.body.data.items.length,
    workers: workers.body.data.items.map((worker) => ({
      id: worker.id,
      workerCode: worker.workerCode,
      status: worker.status,
      capacity: worker.capacity,
      activeSessionCount: worker.activeSessionCount,
      warmPoolReady: worker.warmPoolReady,
      warmPoolTarget: worker.warmPoolTarget,
      queuedOperationCount: worker.resourceSummary?.queuedOperationCount,
      runningSandboxCount: worker.resourceSummary?.runningSandboxCount,
    })),
    sandboxSummary: sandboxes.body.data.summary,
    queueCount: queues.body.data.items.length,
    quotaCount: quotas.body.data.items.length,
  }
}

async function captureSystemSnapshot(): Promise<SystemSnapshot> {
  const [queues, sandboxes, workers] = await Promise.all([
    requestJson<ApiEnvelope<SystemQueuesResponse>>(`/api/system/queues?limit=${systemLimit}`),
    requestJson<ApiEnvelope<SystemSandboxesResponse>>(`/api/system/sandboxes?limit=${systemLimit}`),
    requestJson<ApiEnvelope<WorkerListResponse>>("/api/worker/list"),
  ])
  return {
    at: Date.now(),
    queuedOperations: queues.body.data.items.filter((item) => item.status === "queued").length,
    runningOperations: queues.body.data.items.filter((item) => item.status === "running").length,
    preparingSandboxes: (sandboxes.body.data.summary.preparing || 0),
    runningSandboxes: (sandboxes.body.data.summary.running || 0),
    workerLoads: workers.body.data.items.map((worker) => ({
      id: worker.id,
      status: worker.status,
      activeSessionCount: worker.activeSessionCount,
      queuedOperationCount: worker.resourceSummary?.queuedOperationCount || 0,
      runningSandboxCount: worker.resourceSummary?.runningSandboxCount || 0,
      warmPoolReady: worker.warmPoolReady,
    })),
  }
}

function buildOperationMetrics(sessions: ScenarioSession[], items: RuntimeOperation[]) {
  const sessionIds = new Set(sessions.map((session) => session.sessionId).filter(Boolean))
  const relevant = items
    .filter((item) => item.operationType === "session_open" && item.businessSessionId && sessionIds.has(item.businessSessionId))
    .map((item) => ({
      id: item.id,
      sessionId: item.businessSessionId!,
      workerId: item.workerId,
      status: item.status,
      stage: typeof item.detail?.stage === "string" ? item.detail.stage : undefined,
      stageTimings:
        typeof item.detail?.stageTimings === "object" && item.detail.stageTimings
          ? item.detail.stageTimings as Record<string, unknown>
          : undefined,
      queueDelayMs: readDuration(item.createdAt, item.startedAt),
      runMs: readDuration(item.startedAt, item.completedAt),
      totalMs: readDuration(item.createdAt, item.completedAt),
      errorMessage: item.errorMessage,
      createdAt: item.createdAt,
      startedAt: item.startedAt,
      completedAt: item.completedAt,
    }))
  const bySessionId = new Map(relevant.map((item) => [item.sessionId, item]))
  return {
    items: relevant,
    bySessionId,
    stats: {
      queueDelayMs: summarizeNumbers(relevant.map((item) => item.queueDelayMs)),
      runMs: summarizeNumbers(relevant.map((item) => item.runMs)),
      totalMs: summarizeNumbers(relevant.map((item) => item.totalMs)),
    },
  }
}

function buildSandboxMetrics(sessions: ScenarioSession[], items: SandboxInstance[]) {
  const sessionIds = new Set(sessions.map((session) => session.sessionId).filter(Boolean))
  const relevant = items
    .filter((item) => item.businessSessionId && sessionIds.has(item.businessSessionId) && item.detail?.source !== "warm_pool")
    .map((item) => ({
      id: item.id,
      sessionId: item.businessSessionId,
      workerId: item.workerId,
      status: item.status,
      createToRunningMs: readDuration(item.createdAt, item.openedAt),
      createdAt: item.createdAt,
      openedAt: item.openedAt,
      closedAt: item.closedAt,
    }))
  const bySessionId = new Map(relevant.map((item) => [item.sessionId, item]))
  return {
    items: relevant,
    bySessionId,
    stats: {
      createToRunningMs: summarizeNumbers(relevant.map((item) => item.createToRunningMs)),
    },
  }
}

function buildScenarioSummary(input: {
  sessions: ScenarioSession[]
  operationMetrics: ReturnType<typeof buildOperationMetrics>
  sandboxMetrics: ReturnType<typeof buildSandboxMetrics>
  systemSnapshots: SystemSnapshot[]
  workers: WorkerSummary[]
  sandboxes: Record<string, number>
}) {
  const createStatuses = countBy(input.sessions.map((session) => String(session.createStatus || "unknown")))
  const openStatuses = countBy(input.sessions.map((session) => String(session.openStatus || "unknown")))
  const terminalStatuses = countBy(input.sessions.map((session) => session.terminalStatus || "unknown"))
  const activeSessions = input.sessions.filter((session) => session.activeAt)
  const workerSpread = countBy(activeSessions.map((session) => session.workerId || ""))
  const maxQueuedOperations = Math.max(0, ...input.systemSnapshots.map((item) => item.queuedOperations))
  const maxRunningOperations = Math.max(0, ...input.systemSnapshots.map((item) => item.runningOperations))
  const maxPreparingSandboxes = Math.max(0, ...input.systemSnapshots.map((item) => item.preparingSandboxes))
  const maxRunningSandboxes = Math.max(0, ...input.systemSnapshots.map((item) => item.runningSandboxes))
  return {
    createdSessions: input.sessions.filter((session) => session.createStatus === 200).length,
    openedSessions: input.sessions.filter((session) => session.openStatus === 200).length,
    activeSessions: activeSessions.length,
    createStatuses,
    openStatuses,
    terminalStatuses,
    workerSpread,
    createMs: summarizeNumbers(input.sessions.map((session) => duration(session.createStartedAt, session.createCompletedAt))),
    openRequestMs: summarizeNumbers(input.sessions.map((session) => duration(session.openStartedAt, session.openCompletedAt))),
    openToActiveMs: summarizeNumbers(input.sessions.map((session) => duration(session.openStartedAt, session.activeAt))),
    createToActiveMs: summarizeNumbers(input.sessions.map((session) => duration(session.createStartedAt, session.activeAt))),
    operationQueueDelayMs: input.operationMetrics.stats.queueDelayMs,
    operationRunMs: input.operationMetrics.stats.runMs,
    operationTotalMs: input.operationMetrics.stats.totalMs,
    sandboxCreateToRunningMs: input.sandboxMetrics.stats.createToRunningMs,
    maxQueuedOperations,
    maxRunningOperations,
    maxPreparingSandboxes,
    maxRunningSandboxes,
    finalSandboxSummary: input.sandboxes,
    finalWorkers: input.workers.map((worker) => ({
      id: worker.id,
      status: worker.status,
      activeSessionCount: worker.activeSessionCount,
      queuedOperationCount: worker.resourceSummary?.queuedOperationCount || 0,
      runningSandboxCount: worker.resourceSummary?.runningSandboxCount || 0,
      warmPoolReady: worker.warmPoolReady,
    })),
  }
}

async function stopWorkerContainer(containerName: string) {
  await runDockerCommand(["stop", containerName], `stop worker container failed: ${containerName}`)
}

async function startWorkerContainer(containerName: string) {
  await runDockerCommand(["start", containerName], `start worker container failed: ${containerName}`)
  await Bun.sleep(workerRestartWaitMs)
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
  if (exitCode === 0) return stdout.trim()
  throw new Error(`${message}: ${stderr || stdout}`)
}

async function requestJson<T>(path: string, init: { method?: string; body?: unknown } = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(`request timeout after ${requestTimeoutMs}ms`), requestTimeoutMs)
  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: init.method || "GET",
      headers: {
        ...(cookieJar.length ? { Cookie: cookieJar.join("; ") } : {}),
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timeout)
    const message = error instanceof Error ? error.message : String(error)
    if (controller.signal.aborted) {
      throw new Error(`request timed out: ${path} timeoutMs=${requestTimeoutMs}`)
    }
    throw new Error(`request failed: ${path} message=${message}`)
  }
  clearTimeout(timeout)
  mergeCookies(response)
  const text = await response.text()
  if (!text.trim()) {
    throw new Error(`empty response: ${path} status=${response.status}`)
  }
  let body: T
  try {
    body = JSON.parse(text) as T
  } catch (error) {
    throw new Error(
      `invalid json response: ${path} status=${response.status} message=${error instanceof Error ? error.message : String(error)} body=${text.slice(0, requestBodySnippetLimit)}`,
    )
  }
  return {
    status: response.status,
    body,
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

function readWorkerContainerName(workerId: string) {
  if (workerId === "worker_local") return "opencode-worker"
  if (!workerId.startsWith("worker_local_")) throw new Error(`unsupported local worker id: ${workerId}`)
  return `opencode-worker-${workerId.replace("worker_local_", "")}`
}

function duration(start?: number, end?: number) {
  if (!start || !end) return undefined
  return end - start
}

function readDuration(start?: string, end?: string) {
  if (!start || !end) return undefined
  return new Date(end).getTime() - new Date(start).getTime()
}

function summarizeNumbers(items: Array<number | undefined>) {
  const values = items.filter((item): item is number => typeof item === "number" && Number.isFinite(item)).sort((left, right) => left - right)
  if (values.length === 0) {
    return {
      count: 0,
      avg: undefined,
      p50: undefined,
      p95: undefined,
      max: undefined,
    }
  }
  return {
    count: values.length,
    avg: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: values[values.length - 1],
  }
}

function percentile(values: number[], ratio: number) {
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * ratio) - 1))
  return values[index]
}

function countBy(items: string[]) {
  return items.reduce<Record<string, number>>((result, item) => {
    if (!item) return result
    result[item] = (result[item] || 0) + 1
    return result
  }, {})
}

function assert(condition: unknown, message: string): asserts condition {
  if (condition) return
  throw new Error(message)
}
