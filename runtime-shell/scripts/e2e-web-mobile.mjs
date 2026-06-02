const baseUrl = process.env.RUNTIME_SHELL_WEB_MOBILE_BASE_URL || "http://127.0.0.1:3100"
const username = process.env.RUNTIME_SHELL_WEB_MOBILE_USERNAME || "admin"
const password = process.env.RUNTIME_SHELL_WEB_MOBILE_PASSWORD || "change-me"

const { chromium } = await import("playwright")

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await context.newPage()
let workspaceContext = null

const result = {
  ok: false,
  baseUrl,
  steps: [],
  assertions: {},
}
let sessionId = ""

try {
  await login(page, username, password)
  result.steps.push("login ok")

  result.assertions.noHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  )
  assert(result.assertions.noHorizontalOverflow, "mobile layout should not overflow horizontally")

  const mobileSidebar = page.locator("aside").first()
  await waitFor(async () => await mobileSidebar.isVisible(), "mobile runtime sidebar should stay visible")
  result.assertions.mobileSidebarVisible = await mobileSidebar.isVisible()
  assert(result.assertions.mobileSidebarVisible, "mobile runtime sidebar should be visible")

  const workspaceName = `Mobile Workspace ${Date.now()}`
  const workspaceId = await createWorkspaceFromSidebar(page, workspaceName)
  result.assertions.mobileWorkspaceCreated = Boolean(workspaceId)
  assert(result.assertions.mobileWorkspaceCreated, "mobile should create workspace")
  result.steps.push("mobile workspace create ok")

  const sessionTitle = `Mobile Session ${Date.now()}`
  sessionId = await createSessionFromSidebar(page, sessionTitle)
  await selectSessionFromSidebar(page, sessionTitle)
  const activeSession = await waitForSessionDetail(page, sessionId, (session) => session?.status === "active")
  result.assertions.mobileSessionActivated = activeSession?.status === "active"
  assert(result.assertions.mobileSessionActivated, "mobile should create and activate session")
  result.steps.push("mobile session create ok")

  // 中文/English: mobile composer keeps one prompt-mode selector in the main
  // area, so bind directly to the control instead of brittle localized text.
  const modeSelect = page.locator("main select").first()
  await waitFor(async () => await modeSelect.isVisible(), "mobile mode selector should exist")
  await waitFor(async () => (await modeSelect.locator("option").count()) >= 2, "mobile mode options should be available")
  result.assertions.mobilePromptModeVisible = (await modeSelect.locator("option").count()) >= 2
  assert(result.assertions.mobilePromptModeVisible, "mobile should still expose prompt mode selector")

  result.ok = true
} finally {
  if (sessionId) {
    try {
      await api(page, "/api/session/close", {
        method: "POST",
        body: { businessSessionId: sessionId },
      })
      result.steps.push("mobile session cleanup ok")
    } catch (error) {
      result.steps.push(`mobile session cleanup failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  console.log(JSON.stringify(result, null, 2))
  await context.close()
  await browser.close()
}

async function login(page, username, password) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 20000 })
  const form = page.locator("form").first()
  await form.locator("input").nth(0).fill(username)
  await form.locator("input").nth(1).fill(password)
  await form.locator('button[type="submit"]').click()
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(1200)
}

async function createWorkspaceFromSidebar(page, name) {
  const me = await api(page, "/api/auth/me")
  const projectId = me.data.user.projectIds[0]
  const created = await api(page, "/api/workspace/create", {
    method: "POST",
    body: { name, projectId },
  })
  workspaceContext = {
    id: created.data.id,
    projectId: created.data.projectId || projectId,
  }
  return workspaceContext.id
}

async function createSessionFromSidebar(page, title) {
  assert(workspaceContext?.id, "workspace context should exist before creating a session")
  const created = await api(page, "/api/session/create", {
    method: "POST",
    body: {
      title,
      projectId: workspaceContext.projectId,
      workspaceId: workspaceContext.id,
      warmup: true,
    },
  })
  const nextSessionId = created.data.id
  await waitForSessionCard(page, title, 30000)
  return nextSessionId
}

async function selectSessionFromSidebar(page, sessionTitle) {
  const sidebar = page.locator("aside").first()
  const card = sidebar.getByRole("button", { name: new RegExp(escapeRegExp(sessionTitle)) }).first()
  await waitFor(async () => await card.isVisible().catch(() => false), `session card should be selectable: ${sessionTitle}`, 15000)
  await card.click()
  await page.waitForTimeout(1200)
}

async function waitForSessionCard(page, sessionTitle, timeoutMs = 15000) {
  const sidebar = page.locator("aside").first()
  const card = sidebar.getByRole("button", { name: new RegExp(escapeRegExp(sessionTitle)) }).first()
  await waitFor(async () => {
    const visible = await card.isVisible().catch(() => false)
    if (visible) return true
    await sidebar.getByRole("button", { name: "刷新" }).click().catch(() => undefined)
    return false
  }, `session card should appear in sidebar: ${sessionTitle}`, timeoutMs)
}

async function waitForSessionDetail(page, sessionId, predicate) {
  let latest = null
  await waitFor(async () => {
    const detail = await api(page, `/api/session/detail?businessSessionId=${encodeURIComponent(sessionId)}`)
    latest = detail.data.session || null
    return Boolean(predicate(latest))
  }, `session detail did not satisfy predicate for ${sessionId}`, 15000)
  return latest
}

async function api(page, path, init = {}) {
  const response = await page.context().request.fetch(new URL(path, baseUrl).toString(), {
    method: init.method || "GET",
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

async function waitFor(check, message, timeoutMs = 12000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(message)
}

function assert(condition, message) {
  if (condition) return
  throw new Error(message)
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
