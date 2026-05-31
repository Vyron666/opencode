const baseUrl = process.env.RUNTIME_SHELL_WEB_STREAMING_SOAK_BASE_URL || "http://127.0.0.1:3100"
const username = process.env.RUNTIME_SHELL_WEB_STREAMING_SOAK_USERNAME || "admin"
const password = process.env.RUNTIME_SHELL_WEB_STREAMING_SOAK_PASSWORD || "change-me"
const chunkCount = Number(process.env.RUNTIME_SHELL_WEB_STREAMING_SOAK_CHUNK_COUNT || "40")
const pageLoadTimeoutMs = 45000
const apiTimeoutMs = 45000
const shortTimeoutMs = 10000

const { chromium } = await import("playwright")

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
const page = await context.newPage()

await page.addInitScript(() => {
  window.__RUNTIME_SHELL_STREAM_DEBUG__ = true
  window.__RUNTIME_SHELL_STREAM_RECORDS__ = []
  const originalDebug = console.debug.bind(console)
  console.debug = (...args) => {
    if (args[0] === "[runtime-shell stream]" && args[1] && typeof args[1] === "object") {
      window.__RUNTIME_SHELL_STREAM_RECORDS__.push({
        ...args[1],
        capturedAt: performance.now(),
      })
    }
    originalDebug(...args)
  }
})

const result = {
  ok: false,
  baseUrl,
  chunkCount,
  steps: [],
  metrics: {
    totalInjectMs: 0,
    finalVisibleMs: 0,
    maxChunkVisibleMs: 0,
    averageChunkVisibleMs: 0,
    directStreamAppendCount: 0,
    maxDirectStreamAppendDelayMs: 0,
    finalTextLength: 0,
  },
  assertions: {},
}

try {
  await login(page, username, password)
  result.steps.push("login ok")

  const workspaceName = `Streaming Soak Workspace ${Date.now()}`
  await createWorkspaceFromSidebar(page, workspaceName)
  result.steps.push("workspace create ok")

  const sessionTitle = `Streaming Soak ${Date.now()}`
  const sessionId = await createSessionFromSidebar(page, sessionTitle)
  await waitForSessionDetail(page, sessionId, (session) => session?.status === "active", 30000)
  await page.waitForTimeout(1000)
  result.steps.push("session create and activate ok")

  const turnToken = `SOAK-${Date.now()}`
  const chunks = Array.from({ length: chunkCount }, (_, index) => `[${index + 1}:${turnToken}]`)
  const expectedFinalText = chunks.join("")
  const visibleDurations = []

  await seedInternalEvent({
    page,
    sessionId,
    event: createSyntheticEvent(sessionId, "user_message_chunk", {
      text: `stream soak user ${turnToken}`,
    }),
  })
  await waitFor(async () => (await readMainText(page)).includes(`stream soak user ${turnToken}`), "user turn should render", shortTimeoutMs)

  const injectStartedAt = Date.now()
  let accumulatedText = ""
  for (const chunk of chunks) {
    const chunkStartedAt = Date.now()
    accumulatedText += chunk
    await seedInternalEvent({
      page,
      sessionId,
      event: createSyntheticEvent(sessionId, "agent_message_chunk", {
        text: chunk,
      }),
    })
    await waitFor(
      async () => (await readMainText(page)).includes(accumulatedText),
      `assistant stream should include ${chunk}`,
      shortTimeoutMs,
      20,
    )
    visibleDurations.push(Date.now() - chunkStartedAt)
  }
  result.metrics.totalInjectMs = Date.now() - injectStartedAt

  const finalVisibleStartedAt = Date.now()
  await waitFor(
    async () => (await readMainText(page)).includes(expectedFinalText),
    "full streamed answer should be visible",
    shortTimeoutMs,
    20,
  )
  result.metrics.finalVisibleMs = Date.now() - finalVisibleStartedAt

  await seedInternalEvent({
    page,
    sessionId,
    event: createSyntheticEvent(sessionId, "turn_completed", {
      stopReason: "end_turn",
    }),
  })

  await waitFor(
    async () => {
      const buttonText = await readComposerButtonText(page)
      return !/模型生成中|等待回答中|等待审批中/.test(buttonText)
    },
    "composer should leave busy state after stream soak completes",
    shortTimeoutMs,
  )

  const streamRecords = await page.evaluate(() => window.__RUNTIME_SHELL_STREAM_RECORDS__ || [])
  const mainText = await readMainText(page)
  result.metrics.maxChunkVisibleMs = Math.max(...visibleDurations)
  result.metrics.averageChunkVisibleMs = Number((visibleDurations.reduce((sum, value) => sum + value, 0) / visibleDurations.length).toFixed(2))
  result.metrics.directStreamAppendCount = streamRecords.length
  result.metrics.maxDirectStreamAppendDelayMs = streamRecords.length
    ? Math.max(...streamRecords.map((item) => Number(item.domAppendDelayMs || 0)))
    : 0
  result.metrics.finalTextLength = expectedFinalText.length

  result.assertions.all_chunks_visible = mainText.includes(expectedFinalText)
  result.assertions.chunk_visibility_stable = visibleDurations.every((value) => value <= 1200)
  result.assertions.direct_stream_used = result.metrics.directStreamAppendCount >= chunkCount - 1
  result.assertions.direct_stream_delay_ok = result.metrics.maxDirectStreamAppendDelayMs <= 120
  result.assertions.final_soak_busy_cleared = !/模型生成中|等待回答中|等待审批中/.test(await readComposerButtonText(page))

  assert(result.assertions.all_chunks_visible, "final streamed soak text should be complete")
  assert(
    result.assertions.chunk_visibility_stable,
    `stream soak chunk visibility regressed: ${JSON.stringify(visibleDurations)}`,
  )
  assert(
    result.assertions.direct_stream_used,
    `direct stream append path should handle most soak chunks: ${result.metrics.directStreamAppendCount}/${chunkCount}`,
  )
  assert(
    result.assertions.direct_stream_delay_ok,
    `direct stream append delay regressed: ${result.metrics.maxDirectStreamAppendDelayMs}ms`,
  )
  assert(result.assertions.final_soak_busy_cleared, "busy state should clear after stream soak")

  result.ok = true
  result.steps.push("stream soak ok")
} finally {
  console.log(JSON.stringify(result, null, 2))
  await context.close()
  await browser.close()
}

async function login(page, username, password) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: pageLoadTimeoutMs })
  const form = page.locator("form").first()
  await form.locator("input").nth(0).fill(username)
  await form.locator("input").nth(1).fill(password)
  await form.locator("button[type='submit']").click()
  await waitFor(async () => await page.locator("aside").last().isVisible().catch(() => false), "login should finish", 30000)
  await page.waitForTimeout(1200)
}

async function createWorkspaceFromSidebar(page, name) {
  await openCreateTab(page)
  const sidebar = page.locator("aside.sidebar-right")
  const workspaceForm = sidebar.locator("form").nth(0)
  await workspaceForm.locator("input").nth(0).fill(name)
  await workspaceForm.locator("button[type='submit']").click()
  await waitFor(async () => {
    const list = await api(page, "/api/session/list")
    return Array.isArray(list.data.workspaces) && list.data.workspaces.some((workspace) => workspace.name === name)
  }, `workspace should appear in session list: ${name}`, 30000)
}

async function createSessionFromSidebar(page, title) {
  await openCreateTab(page)
  const sidebar = page.locator("aside.sidebar-right")
  const sessionForm = sidebar.locator("form").nth(1)
  await sessionForm.locator("input").nth(0).fill(title)
  await sessionForm.locator("button[type='submit']").click()
  let sessionId = ""
  await waitFor(async () => {
    const list = await api(page, "/api/session/list")
    const created = Array.isArray(list.data.items)
      ? list.data.items.find((session) => session.title === title)
      : null
    sessionId = created?.id || ""
    return Boolean(sessionId)
  }, `session should appear in session list: ${title}`, 30000)
  return sessionId
}

async function readSessionDetail(page, sessionId) {
  const detail = await api(page, `/api/session/detail?businessSessionId=${encodeURIComponent(sessionId)}`)
  return {
    session: detail.data.session || null,
    events: Array.isArray(detail.data.events) ? detail.data.events : [],
  }
}

async function waitForSessionDetail(page, sessionId, predicate, timeoutMs) {
  let latest = { session: null, events: [] }
  await waitFor(async () => {
    latest = await readSessionDetail(page, sessionId)
    return Boolean(predicate(latest.session, latest))
  }, `session detail did not satisfy predicate for ${sessionId}`, timeoutMs)
  return latest
}

async function readMainText(page) {
  return page.locator("main").innerText()
}

async function readComposerButtonText(page) {
  return page.locator("main button[type='submit']").innerText().catch(() => "")
}

async function openCreateTab(page) {
  const tabButton = page
    .locator("aside.sidebar-right > div > div.flex")
    .first()
    .getByRole("button", { name: "新建" })
  await tabButton.click()
  await page.waitForTimeout(300)
}

async function api(page, path, init = {}) {
  const response = await page.context().request.fetch(new URL(path, baseUrl).toString(), {
    method: init.method || "GET",
    timeout: apiTimeoutMs,
    headers: init.body === undefined ? undefined : { "content-type": "application/json" },
    data: init.body,
  })
  const result = {
    status: response.status(),
    body: await response.json(),
  }
  if (result.status !== 200 || result.body.code !== 0) {
    throw new Error(`api request failed: ${path} status=${result.status} body=${JSON.stringify(result.body)}`)
  }
  return result.body
}

async function seedInternalEvent({ page, sessionId, event }) {
  const response = await page.context().request.fetch(new URL("/api/internal/runtime/event-push", baseUrl).toString(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-runtime-worker-token": "change-me-worker-agent",
    },
    data: {
      event,
    },
  })
  const body = await response.json()
  if (response.status() !== 200 || body.code !== 0) {
    throw new Error(`internal event push failed: status=${response.status()} body=${JSON.stringify(body)}`)
  }
  await waitFor(async () => {
    const detail = await readSessionDetail(page, sessionId)
    return detail.events.some((item) => item.eventId === event.eventId)
  }, `synthetic event should persist for ${sessionId}`, shortTimeoutMs)
}

function createSyntheticEvent(sessionId, eventType, payload) {
  return {
    eventId: `evt_stream_soak_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    eventType,
    businessSessionId: sessionId,
    acpSessionId: "ses_stream_soak_test",
    workerId: "worker_local",
    timestamp: new Date().toISOString(),
    payload,
  }
}

async function waitFor(check, message, timeoutMs = shortTimeoutMs, intervalMs = 50) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(message)
}

function assert(condition, message) {
  if (condition) return
  throw new Error(message)
}
