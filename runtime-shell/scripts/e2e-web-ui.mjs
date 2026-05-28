const baseUrl = process.env.RUNTIME_SHELL_WEB_BASE_URL || "http://127.0.0.1:3100"
const adminUsername = process.env.RUNTIME_SHELL_WEB_ADMIN_USERNAME || "admin"
const adminPassword = process.env.RUNTIME_SHELL_WEB_ADMIN_PASSWORD || "change-me"
const sharedUsername = process.env.RUNTIME_SHELL_WEB_SHARED_USERNAME || "developer-secondary"
const sharedPassword = process.env.RUNTIME_SHELL_WEB_SHARED_PASSWORD || "change-me"
const sessionSyncWaitMs = 8000

const { chromium } = await import("playwright")

const browser = await chromium.launch({ headless: true })
const adminContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
const sharedContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
const adminPage = await adminContext.newPage()
const sharedPage = await sharedContext.newPage()

const result = {
  ok: false,
  baseUrl,
  steps: [],
  assertions: {},
  sessionTitle: "",
}

try {
  await login(adminPage, adminUsername, adminPassword)
  result.steps.push("admin login ok")

  const workspaceName = `Workspace E2E ${Date.now()}`
  const workspaceId = await createWorkspaceFromSidebar(adminPage, workspaceName)
  result.assertions.adminCreatesWorkspace = Boolean(workspaceId)
  assert(result.assertions.adminCreatesWorkspace, "admin should create workspace from sidebar")
  result.steps.push("admin create workspace ok")

  const sessionTitle = `Web E2E ${Date.now()}`
  result.sessionTitle = sessionTitle
  const sessionId = await createSessionFromSidebar(adminPage, sessionTitle)
  result.assertions.adminCreatesSession = Boolean(sessionId)
  assert(result.assertions.adminCreatesSession, "admin should create session from sidebar")
  result.steps.push("admin create session ok")

  const activeSession = await waitForSessionDetail(adminPage, sessionId, (session) => session?.status === "active")
  result.assertions.adminSessionActivated = activeSession?.status === "active"
  assert(result.assertions.adminSessionActivated, "create and enter should open the new session automatically")
  result.steps.push("admin auto-open session ok")

  const modeCheck = await verifyPromptMode(adminPage, sessionId)
  result.assertions.adminPromptModes = modeCheck.availableModes
  result.assertions.adminPromptModeBeforeSwitch = modeCheck.beforeSwitch
  result.assertions.adminPromptModeAfterSwitch = modeCheck.afterSwitch
  result.assertions.adminPromptModeAfterReload = modeCheck.afterReload
  result.assertions.adminPromptModeSwitchPersisted = modeCheck.afterSwitch === modeCheck.afterReload
  assert(modeCheck.availableModes.length >= 2, "admin session should expose at least two prompt modes")
  assert(modeCheck.beforeSwitch, "admin session should have an initial prompt mode")
  assert(modeCheck.afterSwitch && modeCheck.afterSwitch !== modeCheck.beforeSwitch, "prompt mode should switch to another option")
  assert(modeCheck.afterReload === modeCheck.afterSwitch, "prompt mode should persist after reload")
  result.steps.push("admin prompt mode switch ok")

  await login(sharedPage, sharedUsername, sharedPassword)
  result.steps.push("shared user login ok")

  const sharedUser = await api(sharedPage, "/api/auth/me")
  await api(adminPage, "/api/workspace/share/create", {
    method: "POST",
    body: {
      workspaceId,
      projectId: activeSession.projectId,
      targetUserId: sharedUser.data.user.id,
    },
  })
  result.steps.push("workspace share by api ok")

  const sharedBodyText = await waitForBodyText(sharedPage, (text) => text.includes(sessionTitle), sessionSyncWaitMs)
  result.assertions.sharedUserSeesSessionCard = sharedBodyText.includes(sessionTitle)
  assert(result.assertions.sharedUserSeesSessionCard, "shared user should see shared session card in UI")

  const sharedList = await api(sharedPage, "/api/session/list")
  result.assertions.sharedUserCreateListExcludesSharedWorkspace = Array.isArray(sharedList.data.workspaces)
    ? sharedList.data.workspaces.every((workspace) => workspace.id !== workspaceId)
    : false
  assert(result.assertions.sharedUserCreateListExcludesSharedWorkspace, "shared workspace should not appear in create-session workspace list")

  await sharedPage.reload({ waitUntil: "domcontentloaded" })
  await sharedPage.waitForTimeout(1200)
  const reloadedSharedBodyText = await waitForBodyText(sharedPage, (text) => text.includes(sessionTitle), sessionSyncWaitMs)
  result.assertions.sharedUserStillSeesSessionAfterReload = reloadedSharedBodyText.includes(sessionTitle)
  assert(result.assertions.sharedUserStillSeesSessionAfterReload, "shared user should keep seeing shared session after reload")
  result.steps.push("shared user session visibility ok")

  await api(adminPage, "/api/session/close", {
    method: "POST",
    body: { businessSessionId: sessionId },
  })
  result.steps.push("admin close session cleanup ok")

  result.ok = true
} finally {
  console.log(JSON.stringify(result, null, 2))
  await adminContext.close()
  await sharedContext.close()
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
  }, `session should appear in session list: ${title}`, 20000)
  return sessionId
}

async function verifyPromptMode(page, sessionId) {
  const select = page.locator("main select").first()
  await waitFor(async () => {
    const visible = await select.isVisible().catch(() => false)
    if (!visible) return false
    const options = await select.locator("option").count()
    return options >= 2
  }, "prompt mode select should become available with multiple options")

  const readOptions = async () =>
    select.locator("option").evaluateAll((nodes) =>
      nodes.map((node) => ({
        value: node.getAttribute("value") || "",
        text: (node.textContent || "").trim(),
      })),
    )

  const availableModes = (await readOptions()).filter((item) => item.value)
  const beforeSwitch = await select.inputValue()
  const targetMode = availableModes.find((item) => item.value !== beforeSwitch)
  assert(targetMode?.value, `prompt mode should have an alternative option: ${JSON.stringify({ availableModes, beforeSwitch })}`)

  await select.selectOption(targetMode.value)
  await page.locator("main button").filter({ hasText: /./ }).nth(0).evaluate((button) => button.textContent)
  await page.locator("main").getByRole("button").filter({ hasText: /./ }).nth(0)
  const buttons = page.locator("main button")
  const count = await buttons.count()
  let switched = false
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index)
    const text = await button.innerText().catch(() => "")
    if (!/切换|鍒囨崲/.test(text)) continue
    await button.click()
    switched = true
    break
  }
  assert(switched, "prompt mode switch button should exist")
  await page.waitForTimeout(1800)

  const afterSwitch = await select.inputValue()
  const detailAfterSwitch = await waitForSessionDetail(page, sessionId, (session) => session?.capabilityState?.modeId === afterSwitch)
  assert(detailAfterSwitch?.capabilityState?.configOptions?.some?.((item) => item.id === "mode" && item.currentValue === afterSwitch), "mode config should stay synchronized after switch")

  await page.reload({ waitUntil: "domcontentloaded" })
  await page.waitForTimeout(1200)
  const reloadedSelect = page.locator("main select").first()
  await waitFor(async () => (await reloadedSelect.locator("option").count()) >= 2, "prompt mode select should remain available after reload")
  const afterReload = await reloadedSelect.inputValue()

  return {
    availableModes: availableModes.map((item) => item.value),
    beforeSwitch,
    afterSwitch,
    afterReload,
  }
}

async function waitForSessionDetail(page, sessionId, predicate) {
  let latest = null
  await waitFor(async () => {
    const detail = await api(page, `/api/session/detail?businessSessionId=${encodeURIComponent(sessionId)}`)
    latest = detail.data.session || null
    return Boolean(predicate(latest))
  }, `session detail did not satisfy predicate for ${sessionId}`)
  return latest
}

async function api(page, path, init = {}) {
  const result = await page.evaluate(
    async ({ path, init }) => {
      const response = await fetch(path, {
        method: init.method || "GET",
        credentials: "include",
        headers: init.body === undefined ? undefined : { "content-type": "application/json" },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      })
      const body = await response.json()
      return {
        status: response.status,
        body,
      }
    },
    { path, init },
  )
  if (result.status !== 200 || result.body.code !== 0) {
    throw new Error(`api request failed: ${path} status=${result.status} body=${JSON.stringify(result.body)}`)
  }
  return result.body
}

async function waitForBodyText(page, predicate, timeoutMs) {
  let latest = ""
  await waitFor(async () => {
    latest = await page.locator("body").innerText()
    return predicate(latest)
  }, "body text did not satisfy predicate", timeoutMs)
  return latest
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
