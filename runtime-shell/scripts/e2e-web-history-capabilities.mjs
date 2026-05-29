const baseUrl = process.env.RUNTIME_SHELL_WEB_HISTORY_BASE_URL || "http://127.0.0.1:3100"
const username = process.env.RUNTIME_SHELL_WEB_HISTORY_USERNAME || "admin"
const password = process.env.RUNTIME_SHELL_WEB_HISTORY_PASSWORD || "change-me"

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

  const workspaceName = `History Workspace ${Date.now()}`
  const workspaceId = await createWorkspaceFromSidebar(page, workspaceName)
  result.assertions.workspaceCreated = Boolean(workspaceId)
  assert(result.assertions.workspaceCreated, "workspace should be created")
  result.steps.push("workspace create ok")

  const sessionTitle = `History Capability ${Date.now()}`
  const sessionId = await createSessionFromSidebar(page, sessionTitle)
  const activeSession = await waitForSessionDetail(page, sessionId, (session) => session?.status === "active")
  assert(activeSession?.status === "active", "session should become active")
  result.steps.push("session create and activate ok")

  const liveCapabilities = await readVisibleRuntimeSelectors(page)
  result.assertions.liveModeOptionCount = liveCapabilities.modeOptionCount
  result.assertions.liveModelOptionCount = liveCapabilities.modelOptionCount
  result.assertions.liveModeValue = liveCapabilities.modeValue
  result.assertions.liveModelValue = liveCapabilities.modelValue
  assert(liveCapabilities.modeOptionCount >= 2, "active session should expose prompt mode options")
  assert(liveCapabilities.modelOptionCount >= 1, "active session should expose model options")
  assert(liveCapabilities.modeValue, "active session should show current mode")
  assert(liveCapabilities.modelValue, "active session should show current model")
  result.steps.push("active session capability selectors visible ok")

  await closeSessionFromSidebar(page)
  const completedSession = await waitForSessionDetail(page, sessionId, (session) => session?.status === "completed")
  assert(completedSession?.status === "completed", "session should become completed after close")
  result.steps.push("session close ok")

  await selectSessionFromSidebar(page, sessionTitle)
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
  }, `session should appear in session list: ${title}`, 20000)
  return sessionId
}

async function selectSessionFromSidebar(page, sessionTitle) {
  const card = page.locator("aside").first().getByRole("button", { name: new RegExp(sessionTitle) }).first()
  await card.click()
  await page.waitForTimeout(1200)
}

async function closeSessionFromSidebar(page) {
  const sidebar = page.locator("aside").first()
  await sidebar.getByRole("button", { name: /关闭当前会话/ }).click()
  const confirmButton = page.getByRole("button", { name: /^关闭$/ }).last()
  await confirmButton.click()
  await page.waitForTimeout(1200)
}

async function readVisibleRuntimeSelectors(page) {
  await openSettingsTab(page)
  const modeForm = page.locator("main form").filter({ hasText: "切换模式" }).first()
  const modelForm = page.locator("aside.sidebar-right form").filter({ hasText: "切换模型" }).first()

  await waitFor(async () => (await modeForm.locator("select").count()) > 0, "mode selector should exist")
  await waitFor(async () => (await modelForm.locator("select").count()) > 0, "model selector should exist")

  const modeSelect = modeForm.locator("select").first()
  const modelSelect = modelForm.locator("select").first()

  await waitFor(async () => (await modeSelect.locator("option").count()) >= 2, "mode selector should contain options")
  await waitFor(async () => (await modelSelect.locator("option").count()) >= 1, "model selector should contain options")

  return {
    modeValue: await modeSelect.inputValue(),
    modelValue: await modelSelect.inputValue(),
    modeOptionCount: await modeSelect.locator("option").count(),
    modelOptionCount: await modelSelect.locator("option").count(),
  }
}

async function openCreateTab(page) {
  await page.locator("aside.sidebar-right button").filter({ hasText: "新建" }).first().click()
  await page.waitForTimeout(300)
}

async function openSettingsTab(page) {
  await page.locator("aside.sidebar-right button").filter({ hasText: "设置" }).first().click()
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
