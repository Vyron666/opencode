const baseUrl = process.env.RUNTIME_SHELL_WEB_SLOW_BASE_URL || "http://127.0.0.1:3100"
const username = process.env.RUNTIME_SHELL_WEB_SLOW_USERNAME || "admin"
const password = process.env.RUNTIME_SHELL_WEB_SLOW_PASSWORD || "change-me"
const delayMs = Number(process.env.RUNTIME_SHELL_WEB_SLOW_DELAY_MS || "1200")

const { chromium } = await import("playwright")

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

const result = {
  ok: false,
  baseUrl,
  delayMs,
  steps: [],
  assertions: {},
}

try {
  await page.route("**/api/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    await route.continue()
  })

  await login(page, username, password)
  result.steps.push("login ok")

  const workspaceName = `Slow Workspace ${Date.now()}`
  const workspaceSidebar = page.locator("aside").last()
  const workspaceForm = workspaceSidebar.locator("form").nth(0)
  await workspaceForm.locator("input").nth(0).fill(workspaceName)
  await workspaceForm.locator('button[type="submit"]').click()

  result.assertions.workspaceButtonShowsPending = await waitForButtonText(workspaceForm, /创建工作区中/i)
  assert(result.assertions.workspaceButtonShowsPending, "workspace create should show pending text under slow network")

  const workspaceId = await waitForWorkspace(page, workspaceName)
  result.assertions.workspaceCreated = Boolean(workspaceId)
  assert(result.assertions.workspaceCreated, "workspace should still be created under slow network")
  result.steps.push("slow workspace create ok")

  const sessionTitle = `Slow Session ${Date.now()}`
  const sessionForm = workspaceSidebar.locator("form").nth(1)
  await sessionForm.locator("input").nth(0).fill(sessionTitle)
  await sessionForm.locator('button[type="submit"]').click()

  result.assertions.sessionButtonShowsPending = await waitForButtonText(sessionForm, /创建中/i)
  assert(result.assertions.sessionButtonShowsPending, "session create should show pending text under slow network")

  const sessionId = await waitForSession(page, sessionTitle)
  result.assertions.sessionCreated = Boolean(sessionId)
  assert(result.assertions.sessionCreated, "session should still be created under slow network")

  result.assertions.chatShowsPreparing = await waitForBodyText(page, (text) => text.includes("会话准备中"))
  assert(result.assertions.chatShowsPreparing, "chat area should show preparing state under slow network")

  const activeSession = await waitForSessionDetail(page, sessionId, (session) => session?.status === "active", 30000)
  result.assertions.sessionActivated = activeSession?.status === "active"
  assert(result.assertions.sessionActivated, "session should become active under slow network")
  result.steps.push("slow session activate ok")

  const modeSelect = page.locator("main select").first()
  await waitFor(async () => (await modeSelect.locator("option").count()) >= 2, "mode selector should become available", 30000)
  const beforeSwitch = await modeSelect.inputValue()
  const targetMode = await modeSelect.locator("option").evaluateAll((nodes, current) => {
    const next = nodes
      .map((node) => node.getAttribute("value") || "")
      .find((value) => value && value !== current)
    return next || ""
  }, beforeSwitch)
  assert(targetMode, "slow-network session should still expose alternative mode")

  await modeSelect.selectOption(targetMode)
  const modeButton = page
    .locator("main button")
    .filter({ hasText: /切换模式|切换中/i })
    .first()
  await modeButton.click()

  result.assertions.modeButtonShowsPending = await waitForButtonLocatorText(modeButton, /切换中/i)
  assert(result.assertions.modeButtonShowsPending, "mode update should show pending text under slow network")

  const afterSwitch = await waitForModeValue(modeSelect, targetMode, 30000)
  result.assertions.modeSwitched = afterSwitch === targetMode
  assert(result.assertions.modeSwitched, "mode should eventually switch under slow network")
  result.steps.push("slow mode switch ok")

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
  // 中文/English: under artificial delay, auth bootstrap can finish before the
  // old login form fully detaches, so wait for the runtime sidebar instead.
  await waitFor(
    async () => await page.locator("aside").last().isVisible().catch(() => false),
    "login should finish",
    30000,
  )
  await page.waitForTimeout(800)
}

async function waitForWorkspace(page, workspaceName) {
  let workspaceId = ""
  await waitFor(async () => {
    const list = await api(page, "/api/session/list")
    const created = Array.isArray(list.data.workspaces)
      ? list.data.workspaces.find((workspace) => workspace.name === workspaceName)
      : null
    workspaceId = created?.id || ""
    return Boolean(workspaceId)
  }, `workspace should appear in session list: ${workspaceName}`, 30000)
  return workspaceId
}

async function waitForSession(page, sessionTitle) {
  let sessionId = ""
  await waitFor(async () => {
    const list = await api(page, "/api/session/list")
    const created = Array.isArray(list.data.items)
      ? list.data.items.find((session) => session.title === sessionTitle)
      : null
    sessionId = created?.id || ""
    return Boolean(sessionId)
  }, `session should appear in session list: ${sessionTitle}`, 30000)
  return sessionId
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

async function waitForModeValue(select, expectedValue, timeoutMs = 15000) {
  let latest = ""
  await waitFor(async () => {
    latest = await select.inputValue()
    return latest === expectedValue
  }, `mode select should switch to ${expectedValue}`, timeoutMs)
  return latest
}

async function waitForBodyText(page, predicate, timeoutMs = 12000) {
  let latest = ""
  await waitFor(async () => {
    latest = await page.locator("body").innerText()
    return predicate(latest)
  }, "body text did not satisfy predicate", timeoutMs)
  return latest
}

async function waitForButtonText(scope, pattern, timeoutMs = 12000) {
  let matched = false
  await waitFor(async () => {
    const text = await scope.locator("button[type='submit']").innerText().catch(() => "")
    matched = pattern.test(text)
    return matched
  }, `button text should match ${pattern}`, timeoutMs)
  return matched
}

async function waitForButtonLocatorText(button, pattern, timeoutMs = 12000) {
  let matched = false
  await waitFor(async () => {
    const text = await button.innerText().catch(() => "")
    matched = pattern.test(text)
    return matched
  }, `button text should match ${pattern}`, timeoutMs)
  return matched
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
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(message)
}

function assert(condition, message) {
  if (condition) return
  throw new Error(message)
}
