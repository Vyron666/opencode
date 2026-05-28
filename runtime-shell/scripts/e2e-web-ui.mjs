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
const sharedSessionListResponses = []

sharedPage.on("response", async (response) => {
  if (!response.url().includes("/api/session/list")) return
  try {
    const body = await response.json()
    sharedSessionListResponses.push({
      status: response.status(),
      titles: Array.isArray(body?.data?.items) ? body.data.items.map((item) => item.title) : [],
    })
  } catch {
    sharedSessionListResponses.push({ status: response.status(), titles: [] })
  }
})

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
  await createWorkspaceFromSidebar(adminPage, workspaceName)
  result.steps.push("admin create workspace ok")

  const sessionTitle = `Web E2E ${Date.now()}`
  result.sessionTitle = sessionTitle
  await createSessionFromSidebar(adminPage, sessionTitle)
  result.steps.push("admin create session ok")

  const adminCreateText = await readRightSidebar(adminPage)
  const adminBodyText = await adminPage.locator("body").innerText()
  result.assertions.adminSeesCreatedWorkspace = adminBodyText.includes(workspaceName)
  result.assertions.adminSeesWorkspaceSharePanel = adminCreateText.includes("工作区共享")
  assert(result.assertions.adminSeesCreatedWorkspace, "admin should see newly created workspace")
  assert(result.assertions.adminSeesWorkspaceSharePanel, "admin should see workspace share panel after create")

  await openSettingsTab(adminPage)
  const adminSettingsText = await readRightSidebar(adminPage)
  result.assertions.adminSeesWorkerOverview = adminSettingsText.includes("Worker 运行视图")
  assert(result.assertions.adminSeesWorkerOverview, "admin should see worker overview in settings")
  result.steps.push("admin settings panels ok")

  await login(sharedPage, sharedUsername, sharedPassword)
  result.steps.push("shared user login ok")
  const sharedProfile = await getCurrentUser(sharedPage)

  await openCreateTab(adminPage)
  const shareSelect = adminPage.locator("aside").last().locator("select").last()
  const shareOptions = await shareSelect.locator("option").evaluateAll((nodes) =>
    nodes.map((node) => ({
      value: node.getAttribute("value") || "",
      text: (node.textContent || "").trim(),
    })),
  )
  const sharedTarget = shareOptions.find((item) => item.text.includes(sharedProfile.displayName))
  assert(sharedTarget?.value, "shared target option missing")
  await shareSelect.selectOption(sharedTarget.value)
  await adminPage.getByRole("button", { name: "共享当前工作区" }).click()
  await adminPage.waitForTimeout(1400)

  const adminSharedText = await readRightSidebar(adminPage)
  result.assertions.adminSeesSharedMember = adminSharedText.includes(sharedProfile.displayName)
  assert(result.assertions.adminSeesSharedMember, "admin should see shared member after share")
  result.steps.push("admin share workspace ok")

  const sharedBodyText = await waitForBodyText(sharedPage, (text) => text.includes(sessionTitle), sessionSyncWaitMs)
  const sharedApiTitles = await sharedPage.evaluate(async () => {
    const response = await fetch("/api/session/list", { credentials: "include" })
    const body = await response.json()
    return Array.isArray(body?.data?.items) ? body.data.items.map((item) => item.title) : []
  })
  result.assertions.sharedUserSeesSessionCard = sharedBodyText.includes(sessionTitle)
  result.assertions.sharedUserSessionListApiHasCard = sharedApiTitles.includes(sessionTitle)
  result.assertions.sharedUserSessionListPolls = sharedSessionListResponses
  assert(result.assertions.sharedUserSeesSessionCard, "shared user should see shared session card")

  const sharedCreatePanelText = await currentCreatePanelText(sharedPage)
  result.assertions.sharedUserCreateListExcludesSharedWorkspace = !sharedCreatePanelText.includes(workspaceName)
  assert(result.assertions.sharedUserCreateListExcludesSharedWorkspace, "shared workspace should not appear in create-session workspace list")

  await selectSession(sharedPage, sessionTitle)
  await openCreateTab(sharedPage)
  const sharedCreateText = await readRightSidebar(sharedPage)
  result.assertions.sharedUserSeesWorkspaceSharePanel = sharedCreateText.includes("工作区共享")
  result.assertions.sharedUserSeesCollaborationHint = sharedCreateText.includes("协作")
  result.assertions.sharedUserSeesForkRestriction = sharedCreateText.includes("不允许从当前会话创建分支")
  assert(result.assertions.sharedUserSeesWorkspaceSharePanel, "shared user should still see workspace share panel")
  assert(result.assertions.sharedUserSeesCollaborationHint, "shared user should see collaboration hint")
  assert(result.assertions.sharedUserSeesForkRestriction, "shared user should see fork restriction hint")

  await openSettingsTab(sharedPage)
  const sharedSettingsText = await readRightSidebar(sharedPage)
  result.assertions.sharedUserCannotSeeWorkerOverview = !sharedSettingsText.includes("Worker 运行视图")
  result.assertions.sharedUserCannotSeeProviderConfig = !sharedSettingsText.includes("Provider 配置")
  result.assertions.sharedUserSeesRuntimeRestriction =
    sharedSettingsText.includes("共享工作区下的会话不允许切换模式") ||
    sharedSettingsText.includes("共享工作区下的会话不允许切换模型") ||
    sharedSettingsText.includes("共享工作区下的会话不允许修改运行时配置")
  assert(result.assertions.sharedUserCannotSeeWorkerOverview, "shared user should not see worker overview")
  assert(result.assertions.sharedUserCannotSeeProviderConfig, "shared user should not see provider config")
  assert(result.assertions.sharedUserSeesRuntimeRestriction, "shared user should see runtime restriction hint")
  result.steps.push("shared user restrictions verified")

  await sharedPage.reload({ waitUntil: "networkidle" })
  await sharedPage.waitForTimeout(1200)
  await selectSession(sharedPage, sessionTitle)
  await openCreateTab(sharedPage)
  const reloadedCreateText = await readRightSidebar(sharedPage)
  result.assertions.sharePanelStillAvailableAfterRefresh =
    reloadedCreateText.includes("工作区共享") && reloadedCreateText.includes("协作")
  assert(result.assertions.sharePanelStillAvailableAfterRefresh, "shared workspace panel should remain available after refresh")
  result.steps.push("auth restore keeps workspace share context")

  result.ok = true
} finally {
  console.log(JSON.stringify(result, null, 2))
  await adminContext.close()
  await sharedContext.close()
  await browser.close()
}

async function login(page, username, password) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 20000 })
  await page.locator("input").nth(0).fill(username)
  await page.locator("input").nth(1).fill(password)
  await page.getByRole("button", { name: "进入工作区" }).click()
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(1200)
}

async function getCurrentUser(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/auth/me", { credentials: "include" })
    const body = await response.json()
    return body.data.user
  })
}

async function createWorkspaceFromSidebar(page, name) {
  await openCreateTab(page)
  const workspaceForm = page.locator("aside").last().locator("form").nth(0)
  await workspaceForm.locator("input").nth(0).fill(name)
  await workspaceForm.getByRole("button", { name: "新建工作区" }).click()
  await page.waitForTimeout(1600)
}

async function createSessionFromSidebar(page, title) {
  await openCreateTab(page)
  const sessionForm = page.locator("aside").last().locator("form").nth(1)
  await sessionForm.locator("input").nth(0).fill(title)
  await sessionForm.getByRole("button", { name: "创建并进入" }).click()
  await page.waitForTimeout(1800)
}

async function selectSession(page, sessionTitle) {
  await page.locator("button").filter({ hasText: sessionTitle }).first().click()
  await page.waitForTimeout(900)
}

async function openCreateTab(page) {
  await page.getByRole("button", { name: "新建" }).first().click()
  await page.waitForTimeout(400)
}

async function openSettingsTab(page) {
  await page.getByRole("button", { name: "设置" }).first().click()
  await page.waitForTimeout(500)
}

async function currentCreatePanelText(page) {
  await openCreateTab(page)
  return readRightSidebar(page)
}

async function readRightSidebar(page) {
  return page.locator("aside").last().innerText()
}

async function waitForBodyText(page, predicate, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const text = await page.locator("body").innerText()
    if (predicate(text)) return text
    await page.waitForTimeout(400)
  }
  return page.locator("body").innerText()
}

function assert(condition, message) {
  if (condition) return
  throw new Error(message)
}
