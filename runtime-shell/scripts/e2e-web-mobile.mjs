const baseUrl = process.env.RUNTIME_SHELL_WEB_MOBILE_BASE_URL || "http://127.0.0.1:3100"
const username = process.env.RUNTIME_SHELL_WEB_MOBILE_USERNAME || "admin"
const password = process.env.RUNTIME_SHELL_WEB_MOBILE_PASSWORD || "change-me"

const { chromium } = await import("playwright")

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await context.newPage()

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

  const mobileSidebar = page.locator("aside.sidebar-right")
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
  const activeSession = await waitForSessionDetail(page, sessionId, (session) => session?.status === "active")
  result.assertions.mobileSessionActivated = activeSession?.status === "active"
  assert(result.assertions.mobileSessionActivated, "mobile should create and activate session")
  result.steps.push("mobile session create ok")

  const modeForm = page.locator("main form").filter({ hasText: "切换模式" }).first()
  await waitFor(async () => (await modeForm.locator("select").count()) > 0, "mobile mode selector should exist")
  const modeSelect = modeForm.locator("select").first()
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
  await openCreateTab(page)
  const sidebar = page.locator("aside.sidebar-right")
  const workspaceForm = sidebar.locator("form").nth(0)
  await workspaceForm.locator("input").nth(0).fill(name)
  await workspaceForm.locator('button[type="submit"]').click()
  let workspaceId = ""
  await waitFor(async () => {
    const list = await api(page, "/api/session/list")
    const created = Array.isArray(list.data.workspaces)
      ? list.data.workspaces.find((workspace) => workspace.name === name)
      : null
    workspaceId = created?.id || ""
    return Boolean(workspaceId)
  }, `workspace should appear in session list: ${name}`)
  return workspaceId
}

async function createSessionFromSidebar(page, title) {
  await openCreateTab(page)
  const sidebar = page.locator("aside.sidebar-right")
  const sessionForm = sidebar.locator("form").nth(1)
  await sessionForm.locator("input").nth(0).fill(title)
  await sessionForm.locator('button[type="submit"]').click()
  let sessionId = ""
  await waitFor(async () => {
    const detail = await api(page, "/api/session/list")
    const created = Array.isArray(detail.data.items)
      ? detail.data.items.find((session) => session.title === title)
      : null
    sessionId = created?.id || ""
    return Boolean(sessionId)
  }, `session should appear in session list: ${title}`, 30000)
  return sessionId
}

async function openCreateTab(page) {
  const createTab = page.locator("aside.sidebar-right button").filter({ hasText: "新建" }).first()
  await createTab.click()
  await page.waitForTimeout(300)
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
