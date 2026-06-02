const baseUrl = process.env.RUNTIME_SHELL_WEB_HISTORY_BASE_URL || "http://127.0.0.1:3100"
const username = process.env.RUNTIME_SHELL_WEB_HISTORY_USERNAME || "admin"
const password = process.env.RUNTIME_SHELL_WEB_HISTORY_PASSWORD || "change-me"

const { chromium } = await import("playwright")

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
let workspaceContext = null

const result = {
  ok: false,
  baseUrl,
  steps: [],
  assertions: {},
}

try {
  await login(page, username, password)
  result.steps.push("login ok")

  const workspaceName = `History Workspace ${Date.now()}`
  const workspaceId = await createWorkspaceFromSidebar(page, workspaceName)
  result.assertions.workspaceCreated = Boolean(workspaceId)
  assert(result.assertions.workspaceCreated, "workspace should be created")
  result.steps.push("workspace create ok")

  const sessionTitle = `History Capability ${Date.now()}`
  const sessionId = await createSessionFromSidebar(page, sessionTitle)
  await selectSessionFromSidebar(page, sessionTitle)
  const activeSession = await waitForSessionDetail(page, sessionId, (session) => session?.status === "active")
  assert(activeSession?.status === "active", "session should become active")
  result.assertions.headerShowsSessionTitle = (await readHeaderTitle(page)) === sessionTitle
  assert(result.assertions.headerShowsSessionTitle, "header should show the selected session title")
  result.steps.push("session create and activate ok")

  const liveCapabilities = await readVisibleRuntimeSelectors(page)
  result.assertions.liveModeOptionCount = liveCapabilities.modeOptionCount
  result.assertions.liveModelOptionCount = liveCapabilities.modelOptionCount
  result.assertions.liveModeValue = liveCapabilities.modeValue
  result.assertions.liveModelValue = liveCapabilities.modelValue
  result.assertions.drawerSeparatesMcpAndSkill = liveCapabilities.drawerSeparatesMcpAndSkill
  assert(liveCapabilities.modeOptionCount >= 2, "active session should expose prompt mode options")
  assert(liveCapabilities.modelOptionCount >= 1, "active session should expose model options")
  assert(liveCapabilities.modeValue, "active session should show current mode")
  assert(liveCapabilities.modelValue, "active session should show current model")
  assert(result.assertions.drawerSeparatesMcpAndSkill, "settings drawer should separate MCP and Skill sections")
  result.steps.push("active session capability selectors visible ok")

  await closeSessionFromSidebar(page)
  const completedSession = await waitForSessionDetail(page, sessionId, (session) => session?.status === "completed")
  assert(completedSession?.status === "completed", "session should become completed after close")
  result.steps.push("session close ok")

  await selectSessionFromSidebar(page, sessionTitle)
  await api(page, "/api/acp/session/load", {
    method: "POST",
    body: { businessSessionId: sessionId },
  })
  const loadedHistorySession = await waitForSessionDetail(page, sessionId, (session) => session?.status === "active")
  assert(loadedHistorySession?.status === "active", "history session should be loaded back into an active runtime")
  result.steps.push("history session reopen ok")

  const historyCapabilities = await readVisibleRuntimeSelectors(page)
  result.assertions.historyModeOptionCount = historyCapabilities.modeOptionCount
  result.assertions.historyModelOptionCount = historyCapabilities.modelOptionCount
  result.assertions.historyModeValue = historyCapabilities.modeValue
  result.assertions.historyModelValue = historyCapabilities.modelValue
  result.assertions.historyRetainsMode = historyCapabilities.modeValue === liveCapabilities.modeValue
  result.assertions.historyRetainsModel = historyCapabilities.modelValue === liveCapabilities.modelValue
  assert(historyCapabilities.modeOptionCount >= 2, "history session should rehydrate prompt mode options")
  assert(historyCapabilities.modelOptionCount >= 1, "history session should rehydrate model options")
  assert(historyCapabilities.modeValue, "history session should show current mode")
  assert(historyCapabilities.modelValue, "history session should show current model")
  result.steps.push("history capability selectors visible ok")

  await page.reload({ waitUntil: "domcontentloaded" })
  await page.waitForTimeout(1200)
  const reloadedHistoryCapabilities = await readVisibleRuntimeSelectors(page)
  result.assertions.reloadKeepsHistoryMode = reloadedHistoryCapabilities.modeValue === historyCapabilities.modeValue
  result.assertions.reloadKeepsHistoryModel = reloadedHistoryCapabilities.modelValue === historyCapabilities.modelValue
  assert(result.assertions.reloadKeepsHistoryMode, "reload should keep history mode selected")
  assert(result.assertions.reloadKeepsHistoryModel, "reload should keep history model selected")
  result.steps.push("history capability reload ok")

  await api(page, "/api/session/close", {
    method: "POST",
    body: { businessSessionId: sessionId },
  })
  await waitForSessionDetail(page, sessionId, (session) => session?.status === "completed")
  await selectSessionFromSidebar(page, sessionTitle)
  await api(page, "/api/acp/session/load", {
    method: "POST",
    body: { businessSessionId: sessionId },
  })
  const reselectedHistorySession = await waitForSessionDetail(page, sessionId, (session) => session?.status === "active")
  result.assertions.sameSessionReselectReactivates = reselectedHistorySession?.status === "active"
  assert(result.assertions.sameSessionReselectReactivates, "reselecting the same session should reactivate after external close")
  result.steps.push("same session reselect reactivate ok")

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
  let sessionId = ""
  sessionId = created.data.id
  await waitForSessionCard(page, title)
  return sessionId
}

async function selectSessionFromSidebar(page, sessionTitle) {
  const card = page.locator("aside").first().getByRole("button", { name: new RegExp(sessionTitle) }).first()
  await card.click()
  await page.waitForTimeout(1200)
}

async function closeSessionFromSidebar(page) {
  const sidebar = page.locator("aside").first()
  const actionsButton = sidebar.getByRole("button", { name: "打开会话操作" })
  await actionsButton.click()
  await waitFor(async () => await sidebar.getByRole("button", { name: /关闭当前会话/ }).first().isVisible().catch(() => false), "close session action should become visible")
  await actionsButton.focus()
  await page.keyboard.press("Tab")
  await page.keyboard.press("Tab")
  await page.keyboard.press("Tab")
  await page.keyboard.press("Enter")
  const confirmButton = page.getByRole("button", { name: /^关闭$/ }).last()
  await waitFor(async () => await confirmButton.isVisible().catch(() => false), "close session confirm dialog should open")
  await confirmButton.click()
  await page.waitForTimeout(1200)
}

async function readVisibleRuntimeSelectors(page) {
  const drawer = await openSettingsDrawer(page)
  const drawerText = await drawer.innerText()
  const modeSelect = page.locator("main select").first()
  const modelSelect = page.locator("main select").nth(1)

  await waitFor(async () => await modeSelect.isVisible().catch(() => false), "mode selector should exist")
  await waitFor(async () => await modelSelect.isVisible().catch(() => false), "model selector should exist")

  await waitFor(async () => (await modeSelect.locator("option").count()) >= 2, "mode selector should contain options")
  await waitFor(async () => (await modelSelect.locator("option").count()) >= 1, "model selector should contain options")

  const selectors = {
    modeValue: await modeSelect.inputValue(),
    modelValue: await modelSelect.inputValue(),
    modeOptionCount: await modeSelect.locator("option").count(),
    modelOptionCount: await modelSelect.locator("option").count(),
    drawerSeparatesMcpAndSkill: drawerText.includes("MCP") && drawerText.includes("Skill"),
  }
  await closeSettingsDrawer(page, drawer)
  return selectors
}

async function openSettingsDrawer(page) {
  const drawer = page.locator("aside").filter({ has: page.getByRole("heading", { name: "运行设置" }) }).last()
  const visible = await drawer.isVisible().catch(() => false)
  if (!visible) {
    await page.locator("main header").getByRole("button", { name: "设置" }).click()
    await waitFor(async () => await drawer.isVisible().catch(() => false), "settings drawer should open")
  }
  return drawer
}

async function closeSettingsDrawer(page, drawer) {
  const closeButton = drawer.getByRole("button", { name: "关闭设置" })
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click()
    await waitFor(async () => !(await drawer.isVisible().catch(() => false)), "settings drawer should close")
    return
  }
  await page.keyboard.press("Escape").catch(() => undefined)
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

async function readHeaderTitle(page) {
  return page.locator("main header h1").innerText()
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
