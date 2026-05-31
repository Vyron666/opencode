const baseUrl = process.env.RUNTIME_SHELL_WEB_STREAMING_BASE_URL || "http://127.0.0.1:3100"
const username = process.env.RUNTIME_SHELL_WEB_STREAMING_USERNAME || "admin"
const password = process.env.RUNTIME_SHELL_WEB_STREAMING_PASSWORD || "change-me"
const pageLoadTimeoutMs = 45000
const apiTimeoutMs = 45000
const shortTimeoutMs = 6000

const { chromium } = await import("playwright")

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
const page = await context.newPage()

await page.addInitScript(() => {
  window.__RUNTIME_SHELL_STREAM_DEBUG__ = true
  window.__RUNTIME_SHELL_STREAM_RECORDS__ = []
  window.__RUNTIME_SHELL_ASSISTANT_RENDER_SAMPLES__ = []
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
  const captureAssistantRenderState = () => {
    const cards = Array.from(document.querySelectorAll("[data-assistant-block-key]")).map((element) => ({
      key: element.getAttribute("data-assistant-block-key") || "",
      mode: element.getAttribute("data-assistant-render-mode") || "",
      textLength: (element.textContent || "").trim().length,
    }))
    window.__RUNTIME_SHELL_ASSISTANT_RENDER_SAMPLES__.push({
      at: performance.now(),
      cards,
    })
  }
  const installAssistantObserver = () => {
    captureAssistantRenderState()
    const observer = new MutationObserver(() => {
      captureAssistantRenderState()
    })
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-assistant-render-mode", "data-assistant-block-key"],
    })
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installAssistantObserver, { once: true })
    return
  }
  installAssistantObserver()
})

const result = {
  ok: false,
  baseUrl,
  steps: [],
  metrics: {
    firstChunkVisibleMs: 0,
    perChunkVisibleMs: [],
    directStreamAppendCount: 0,
    maxDirectStreamAppendDelayMs: 0,
  },
  assertions: {},
}

try {
  await login(page, username, password)
  result.steps.push("login ok")

  const workspaceName = `Streaming Workspace ${Date.now()}`
  await createWorkspaceFromSidebar(page, workspaceName)
  result.steps.push("workspace create ok")

  const sessionTitle = `Streaming Flow ${Date.now()}`
  const sessionId = await createSessionFromSidebar(page, sessionTitle)
  await waitForSessionDetail(page, sessionId, (session) => session?.status === "active", 30000)
  await page.waitForTimeout(1000)
  result.steps.push("session create and activate ok")

  const turnToken = `STREAM-${Date.now()}`
  const cumulativeTexts = [`alpha-${turnToken}`, ` beta-${turnToken}`, ` gamma-${turnToken}`, ` omega-${turnToken}`]
  const expectedTexts = cumulativeTexts.reduce((all, chunk) => {
    const previous = all.length ? all[all.length - 1] : ""
    all.push(`${previous}${chunk}`)
    return all
  }, [])

  await seedInternalEvent({
    page,
    sessionId,
    event: createSyntheticEvent(sessionId, "user_message_chunk", {
      text: `stream user ${turnToken}`,
    }),
  })
  await waitFor(async () => (await readMainText(page)).includes(`stream user ${turnToken}`), "user turn should render", shortTimeoutMs)

  for (const [index, chunk] of cumulativeTexts.entries()) {
    const startedAt = Date.now()
    await seedInternalEvent({
      page,
      sessionId,
      event: createSyntheticEvent(sessionId, "agent_message_chunk", {
        text: chunk,
      }),
    })
    await waitFor(
      async () => (await readMainText(page)).includes(expectedTexts[index]),
      `assistant chunk ${index + 1} should render`,
      shortTimeoutMs,
      25,
    )
    const visibleMs = Date.now() - startedAt
    result.metrics.perChunkVisibleMs.push(visibleMs)
    if (index === 0) result.metrics.firstChunkVisibleMs = visibleMs
  }

  await page.evaluate(() => {
    window.__RUNTIME_SHELL_ASSISTANT_FINALIZE_START_AT__ = performance.now()
  })

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
    "composer should leave busy state after synthetic stream completes",
    shortTimeoutMs,
  )

  const streamRecords = await page.evaluate(() => window.__RUNTIME_SHELL_STREAM_RECORDS__ || [])
  result.metrics.directStreamAppendCount = streamRecords.length
  result.metrics.maxDirectStreamAppendDelayMs = streamRecords.length
    ? Math.max(...streamRecords.map((item) => Number(item.domAppendDelayMs || 0)))
    : 0

  result.assertions.first_chunk_fast = result.metrics.firstChunkVisibleMs <= 1200
  result.assertions.each_chunk_continuous = result.metrics.perChunkVisibleMs.every((value) => value <= 1200)
  result.assertions.direct_stream_used = result.metrics.directStreamAppendCount >= cumulativeTexts.length - 1
  result.assertions.direct_stream_delay_ok = result.metrics.maxDirectStreamAppendDelayMs <= 120
  result.assertions.assistant_finalize_keeps_single_visible_card = await verifyAssistantFinalizeKeepsSingleVisibleCard(page)

  assert(result.assertions.first_chunk_fast, `first chunk render regressed: ${result.metrics.firstChunkVisibleMs}ms`)
  assert(result.assertions.each_chunk_continuous, `chunk render cadence regressed: ${JSON.stringify(result.metrics.perChunkVisibleMs)}`)
  assert(result.assertions.direct_stream_used, `direct stream append path was not used enough: ${result.metrics.directStreamAppendCount}`)
  assert(
    result.assertions.direct_stream_delay_ok,
    `direct stream append delay regressed: ${result.metrics.maxDirectStreamAppendDelayMs}ms`,
  )
  assert(
    result.assertions.assistant_finalize_keeps_single_visible_card,
    "assistant finalize should keep one visible card without blank flicker",
  )

  await page.reload({ waitUntil: "domcontentloaded" })
  await waitFor(
    async () => (await readMainText(page)).includes(expectedTexts[expectedTexts.length - 1]),
    "final streamed answer should survive reload",
    shortTimeoutMs,
  )
  result.assertions.stream_survives_reload = (await readMainText(page)).includes(expectedTexts[expectedTexts.length - 1])
  assert(result.assertions.stream_survives_reload, "streamed answer should survive reload")
  result.steps.push("stream rendering and replay ok")

  result.ok = true
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

async function verifyAssistantFinalizeKeepsSingleVisibleCard(page) {
  const { samples, finalizeStartAt } = await page.evaluate(() => ({
    samples: window.__RUNTIME_SHELL_ASSISTANT_RENDER_SAMPLES__ || [],
    finalizeStartAt: window.__RUNTIME_SHELL_ASSISTANT_FINALIZE_START_AT__ || 0,
  }))
  const nonEmptySnapshots = samples
    .map((snapshot) => ({
      at: snapshot.at,
      cards: Array.isArray(snapshot.cards) ? snapshot.cards.filter((card) => card && card.key) : [],
    }))
    .filter((snapshot) => snapshot.cards.length > 0)
  if (nonEmptySnapshots.length === 0) return false
  const assistantKey = nonEmptySnapshots[nonEmptySnapshots.length - 1].cards[0]?.key || ""
  if (!assistantKey) return false
  const tracked = nonEmptySnapshots
    .filter((snapshot) => snapshot.at >= finalizeStartAt)
    .map((snapshot) => ({
      at: snapshot.at,
      cards: snapshot.cards.filter((card) => card.key === assistantKey),
    }))
  if (tracked.length === 0) return false
  return tracked.every((snapshot) => {
    if (snapshot.cards.length !== 1) return false
    const card = snapshot.cards[0]
    return card.textLength > 0 && (card.mode === "plain" || card.mode === "markdown")
  })
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
    eventId: `evt_stream_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    eventType,
    businessSessionId: sessionId,
    acpSessionId: "ses_stream_test",
    workerId: "worker_local",
    timestamp: new Date().toISOString(),
    payload,
  }
}

async function waitFor(check, message, timeoutMs = shortTimeoutMs, intervalMs = 100) {
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
