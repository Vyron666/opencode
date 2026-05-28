const baseUrl = process.env.RUNTIME_SHELL_WEB_BASE_URL || "http://127.0.0.1:3100"
const adminUsername = process.env.RUNTIME_SHELL_WEB_ADMIN_USERNAME || "admin"
const adminPassword = process.env.RUNTIME_SHELL_WEB_ADMIN_PASSWORD || "change-me"
const sharedUsername = process.env.RUNTIME_SHELL_WEB_SHARED_USERNAME || "developer-secondary"
const sharedPassword = process.env.RUNTIME_SHELL_WEB_SHARED_PASSWORD || "change-me"

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

  await adminPage.getByRole("button", { name: "新建" }).click()
  await adminPage.waitForTimeout(400)

  const sessionTitle = `Web E2E ${Date.now()}`
  result.sessionTitle = sessionTitle
  await adminPage.locator("input").nth(2).fill(sessionTitle)
  await adminPage.getByRole("button", { name: "创建并进入" }).click()
  await adminPage.waitForTimeout(1600)
  result.steps.push("admin create session ok")

  const adminCreateText = await readRightSidebar(adminPage)
  result.assertions.adminSeesSharePanel = adminCreateText.includes("会话共享")
  assert(result.assertions.adminSeesSharePanel, "admin should see session share panel after create")

  await adminPage.getByRole("button", { name: "设置" }).click()
  await adminPage.waitForTimeout(600)
  const adminSettingsText = await readRightSidebar(adminPage)
  result.assertions.adminSeesWorkerOverview = adminSettingsText.includes("Worker 运行视图")
  assert(result.assertions.adminSeesWorkerOverview, "admin should see worker overview in settings")
  result.steps.push("admin settings panels ok")

  await adminPage.getByRole("button", { name: "新建" }).click()
  await adminPage.waitForTimeout(400)
  const shareSelect = adminPage.locator("aside").last().locator("select").last()
  const shareOptions = await shareSelect.locator("option").evaluateAll((nodes) =>
    nodes.map((node) => ({
      value: node.getAttribute("value") || "",
      text: (node.textContent || "").trim(),
    })),
  )
  const sharedTarget = shareOptions.find((item) => item.text.includes("Runtime Developer Secondary"))
  assert(sharedTarget?.value, "shared target option missing")
  await shareSelect.selectOption(sharedTarget.value)
  await adminPage.getByRole("button", { name: "分享当前会话" }).click()
  await adminPage.waitForTimeout(1400)
  const adminSharedText = await readRightSidebar(adminPage)
  result.assertions.adminSeesSharedMember = adminSharedText.includes("Runtime Developer Secondary")
  assert(result.assertions.adminSeesSharedMember, "admin should see shared member after share")
  result.steps.push("admin share session ok")

  await login(sharedPage, sharedUsername, sharedPassword)
  result.steps.push("shared user login ok")

  const bodyText = await sharedPage.locator("body").innerText()
  result.assertions.sharedUserSeesSessionCard = bodyText.includes(sessionTitle)
  assert(result.assertions.sharedUserSeesSessionCard, "shared user should see shared session card")

  await sharedPage.getByText(sessionTitle, { exact: false }).first().click()
  await sharedPage.waitForTimeout(900)

  await sharedPage.getByRole("button", { name: "新建" }).click()
  await sharedPage.waitForTimeout(500)
  const sharedCreateText = await readRightSidebar(sharedPage)
  result.assertions.sharedUserSeesSharePanel = sharedCreateText.includes("会话共享")
  result.assertions.sharedUserSeesCollaborationHint = sharedCreateText.includes("协作中")
  result.assertions.sharedUserSeesForkRestriction = sharedCreateText.includes("不允许从当前会话创建分支")
  assert(result.assertions.sharedUserSeesSharePanel, "shared user should still see session share panel")
  assert(result.assertions.sharedUserSeesCollaborationHint, "shared user should see collaboration hint")
  assert(result.assertions.sharedUserSeesForkRestriction, "shared user should see fork restriction hint")

  await sharedPage.getByRole("button", { name: "设置" }).click()
  await sharedPage.waitForTimeout(500)
  const sharedSettingsText = await readRightSidebar(sharedPage)
  result.assertions.sharedUserCannotSeeWorkerOverview = !sharedSettingsText.includes("Worker 运行视图")
  result.assertions.sharedUserCannotSeeProviderConfig = !sharedSettingsText.includes("Provider 配置")
  result.assertions.sharedUserSeesRuntimeRestriction =
    sharedSettingsText.includes("共享会话不允许切换模式") ||
    sharedSettingsText.includes("共享会话不允许切换模型") ||
    sharedSettingsText.includes("共享会话不允许更新运行时配置")
  assert(result.assertions.sharedUserCannotSeeWorkerOverview, "shared user should not see worker overview")
  assert(result.assertions.sharedUserCannotSeeProviderConfig, "shared user should not see provider config")
  assert(result.assertions.sharedUserSeesRuntimeRestriction, "shared user should see runtime restriction hint")
  result.steps.push("shared user restrictions verified")

  await sharedPage.reload({ waitUntil: "networkidle" })
  await sharedPage.waitForTimeout(1200)
  await sharedPage.getByText(sessionTitle, { exact: false }).first().click()
  await sharedPage.waitForTimeout(900)
  await sharedPage.getByRole("button", { name: "新建" }).click()
  await sharedPage.waitForTimeout(500)
  const reloadedCreateText = await readRightSidebar(sharedPage)
  result.assertions.sharePanelStillAvailableAfterRefresh =
    reloadedCreateText.includes("会话共享") && reloadedCreateText.includes("协作中")
  assert(result.assertions.sharePanelStillAvailableAfterRefresh, "shared session panel should remain available after refresh")
  result.steps.push("auth restore keeps share panel context")

  result.ok = true
} finally {
  console.log(JSON.stringify(result, null, 2))
  await adminContext.close()
  await sharedContext.close()
  await browser.close()
}

async function login(page, username, password) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 20000 })
  await page.getByPlaceholder("请输入用户名").fill(username)
  await page.getByPlaceholder("请输入密码").fill(password)
  await page.getByRole("button", { name: "进入工作区" }).click()
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(1200)
}

async function readRightSidebar(page) {
  return page.locator("aside").last().innerText()
}

function assert(condition, message) {
  if (condition) return
  throw new Error(message)
}
