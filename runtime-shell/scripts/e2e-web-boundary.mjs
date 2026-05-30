const baseUrl = process.env.RUNTIME_SHELL_WEB_BOUNDARY_BASE_URL || "http://127.0.0.1:3100"
const username = process.env.RUNTIME_SHELL_WEB_BOUNDARY_USERNAME || "admin"
const password = process.env.RUNTIME_SHELL_WEB_BOUNDARY_PASSWORD || "change-me"

const { chromium } = await import("playwright")

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

const result = {
  ok: false,
  baseUrl,
  steps: [],
  assertions: {},
}

try {
  await login(page, username, password)
  result.steps.push("login ok")

  const workspaceName = `Boundary ${Date.now()}`
  const workspaceId = await createWorkspaceFromSidebar(page, workspaceName)
  result.assertions.workspaceCreated = Boolean(workspaceId)
  assert(result.assertions.workspaceCreated, "workspace should be created")
  result.steps.push("workspace create ok")

  const sessionTitleA = `Boundary A ${Date.now()}`
  const sessionIdA = await createSessionFromSidebar(page, sessionTitleA)
  await waitForSessionDetail(page, sessionIdA, (session) => session?.status === "active", 30000)
  result.steps.push("session A create and open ok")

  const sessionTitleB = `Boundary B ${Date.now()}`
  const sessionIdB = await createSessionFromSidebar(page, sessionTitleB)
  await waitForSessionDetail(page, sessionIdB, (session) => session?.status === "active", 30000)
  result.steps.push("session B create and open ok")
  result.assertions.latestSessionUrlBound = page.url().includes(`session=${encodeURIComponent(sessionIdB)}`)
  assert(result.assertions.latestSessionUrlBound, "latest session should sync to URL")

  await page.reload({ waitUntil: "domcontentloaded" })
  await page.waitForTimeout(1200)
  const bodyAfterReload = await page.locator("body").innerText()
  result.assertions.reloadKeepsLatestSessionVisible =
    bodyAfterReload.includes(sessionTitleB) || bodyAfterReload.includes("正在恢复会话")
  assert(
    result.assertions.reloadKeepsLatestSessionVisible,
    "reload should keep latest session visible or show recovery state",
  )

  await waitFor(async () => {
    const text = await page.locator("body").innerText()
    return text.includes(sessionTitleB)
  }, "reload should eventually show latest session title", 12000)

  await page.evaluate(() => window.history.back())
  await page.waitForTimeout(1200)
  await waitFor(
    () => page.url().includes(`session=${encodeURIComponent(sessionIdA)}`),
    "back should update session URL",
  )
  const detailAfterBack = await waitForSessionDetail(page, sessionIdA, (session) => session?.id === sessionIdA)
  result.assertions.backNavigatesToPreviousSession = detailAfterBack?.id === sessionIdA
  assert(result.assertions.backNavigatesToPreviousSession, "back should navigate to previous session")

  await page.evaluate(() => window.history.forward())
  await page.waitForTimeout(1200)
  await waitFor(
    () => page.url().includes(`session=${encodeURIComponent(sessionIdB)}`),
    "forward should update session URL",
  )
  const detailAfterForward = await waitForSessionDetail(page, sessionIdB, (session) => session?.id === sessionIdB)
  result.assertions.forwardNavigatesToLatestSession = detailAfterForward?.id === sessionIdB
  assert(result.assertions.forwardNavigatesToLatestSession, "forward should navigate to latest session")

  const sessionList = await api(page, "/api/session/list")
  result.assertions.workspaceListContainsBoundary = Array.isArray(sessionList.data.workspaces)
    ? sessionList.data.workspaces.some((item) => item.id === workspaceId)
    : false
  assert(result.assertions.workspaceListContainsBoundary, "session list should still contain created workspace")

  result.ok = true
} finally {
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
  const sidebar = page.locator("aside").last()
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
  const sidebar = page.locator("aside").last()
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

async function waitForSessionDetail(page, sessionId, predicate, timeoutMs = 15000) {
  let latest = null
  await waitFor(async () => {
    const detail = await api(page, `/api/session/detail?businessSessionId=${encodeURIComponent(sessionId)}`)
    latest = detail.data.session || null
    return Boolean(predicate(latest))
  }, `session detail did not satisfy predicate for ${sessionId}`, timeoutMs)
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
