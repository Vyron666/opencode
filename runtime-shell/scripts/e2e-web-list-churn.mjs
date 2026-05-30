const baseUrl = process.env.RUNTIME_SHELL_WEB_LIST_BASE_URL || "http://127.0.0.1:3100"
const username = process.env.RUNTIME_SHELL_WEB_LIST_USERNAME || "admin"
const password = process.env.RUNTIME_SHELL_WEB_LIST_PASSWORD || "change-me"
const workspaceCount = Number(process.env.RUNTIME_SHELL_WEB_LIST_WORKSPACE_COUNT || "6")
const sessionCount = Number(process.env.RUNTIME_SHELL_WEB_LIST_SESSION_COUNT || "18")

const { chromium } = await import("playwright")

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
const page = await context.newPage()

const result = {
  ok: false,
  baseUrl,
  workspaceCount,
  sessionCount,
  steps: [],
  assertions: {},
}

try {
  await login(page, username, password)
  result.steps.push("login ok")

  const workspaces = []
  for (let index = 0; index < workspaceCount; index += 1) {
    const workspaceName = `Long Workspace ${index + 1} ${Date.now()}`
    workspaces.push(await createWorkspaceByApi(page, workspaceName))
  }
  result.assertions.workspaceBatchCreated = workspaces.length === workspaceCount && workspaces.every((workspace) => workspace?.id)
  assert(result.assertions.workspaceBatchCreated, "long-list setup should create all workspaces")
  result.steps.push("workspace batch create ok")

  const sessions = []
  for (let index = 0; index < sessionCount; index += 1) {
    const workspace = workspaces[index % workspaces.length]
    const title = `Long Session ${String(index + 1).padStart(2, "0")} ${Date.now()}`
    sessions.push(await createSessionByApi(page, title, workspace))
  }
  result.assertions.sessionBatchCreated = sessions.length === sessionCount && sessions.every((session) => session?.id)
  assert(result.assertions.sessionBatchCreated, "long-list setup should create all sessions")
  result.steps.push("session batch create ok")

  const leftSidebar = page.locator("aside").first()
  const sessionScroller = leftSidebar.locator("div.max-h-\\[300px\\].overflow-y-auto").first()
  result.assertions.sessionScrollerVisible = await sessionScroller.isVisible()
  assert(result.assertions.sessionScrollerVisible, "session list scroller should be visible")

  const latestSession = sessions.at(-1)
  assert(latestSession, "latest session should exist")
  await selectSessionCard(page, latestSession.title)
  const latestActive = await waitForSessionDetail(page, latestSession.id, (session) => session?.id === latestSession.id && session?.status === "active", 30000)
  result.assertions.latestSessionSelected = latestActive?.id === latestSession.id
  assert(result.assertions.latestSessionSelected, "latest long-list session should be selectable")

  const earliestSession = sessions[0]
  assert(earliestSession, "earliest session should exist")
  await scrollSessionListToTop(sessionScroller)
  await selectSessionCard(page, earliestSession.title)
  const earliestActive = await waitForSessionDetail(page, earliestSession.id, (session) => session?.id === earliestSession.id && session?.status === "active", 30000)
  result.assertions.earliestSessionSelected = earliestActive?.id === earliestSession.id
  assert(result.assertions.earliestSessionSelected, "earliest long-list session should be selectable after scroll")

  await page.reload({ waitUntil: "domcontentloaded" })
  await page.waitForTimeout(1200)
  const bodyAfterReload = await page.locator("body").innerText()
  result.assertions.reloadKeepsSelectedSession = bodyAfterReload.includes(earliestSession.title)
  assert(result.assertions.reloadKeepsSelectedSession, "reload should keep selected long-list session visible")

  await selectSessionCard(page, latestSession.title)
  await waitForSessionDetail(page, latestSession.id, (session) => session?.id === latestSession.id, 30000)
  const afterLatestUrl = page.url()
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.waitForTimeout(1000)
  await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {})
  await waitFor(() => page.url().includes(`session=${encodeURIComponent(earliestSession.id)}`), "back should restore earliest session URL", 15000)
  await waitForSessionDetail(page, earliestSession.id, (session) => session?.id === earliestSession.id, 30000)
  await page.goForward({ waitUntil: "domcontentloaded" }).catch(() => {})
  await waitFor(() => page.url() === afterLatestUrl, "forward should restore latest session URL", 15000)
  const latestAfterForward = await waitForSessionDetail(page, latestSession.id, (session) => session?.id === latestSession.id, 30000)
  result.assertions.forwardRestoresLatestSelection = latestAfterForward?.id === latestSession.id
  assert(result.assertions.forwardRestoresLatestSelection, "forward should restore latest long-list selection")
  result.steps.push("list churn navigation ok")

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

async function createWorkspaceByApi(page, name) {
  const list = await api(page, "/api/session/list")
  const projectId = list.data.workspaces?.[0]?.projectId || "default"
  await api(page, "/api/workspace/create", {
    method: "POST",
    body: {
      name,
      projectId,
    },
  })
  let created = null
  await waitFor(async () => {
    const refreshed = await api(page, "/api/session/list")
    created = Array.isArray(refreshed.data.workspaces)
      ? refreshed.data.workspaces.find((workspace) => workspace.name === name) || null
      : null
    return Boolean(created?.id)
  }, `workspace should appear in session list: ${name}`, 30000)
  return created
}

async function createSessionByApi(page, title, workspace) {
  const createdSession = await api(page, "/api/session/create", {
    method: "POST",
    body: {
      title,
      projectId: workspace.projectId,
      workspaceId: workspace.id,
    },
  })
  // 中文/English: long-list setup only needs historical cards, so close the
  // freshly created session immediately and avoid holding worker capacity.
  await api(page, "/api/session/close", {
    method: "POST",
    body: {
      businessSessionId: createdSession.data.id,
    },
  })
  let created = null
  await waitFor(async () => {
    const list = await api(page, "/api/session/list")
    created = Array.isArray(list.data.items)
      ? list.data.items.find((session) => session.title === title) || null
      : null
    return Boolean(created?.id && created.status === "completed")
  }, `session should appear in session list: ${title}`, 30000)
  return created
}

async function selectSessionCard(page, title) {
  const leftSidebar = page.locator("aside").first()
  const card = leftSidebar.getByRole("button", { name: new RegExp(title) }).first()
  await card.scrollIntoViewIfNeeded()
  await card.click()
  await page.waitForTimeout(600)
}

async function scrollSessionListToTop(scroller) {
  await scroller.evaluate((element) => {
    element.scrollTop = 0
  })
  await new Promise((resolve) => setTimeout(resolve, 300))
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
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(message)
}

function assert(condition, message) {
  if (condition) return
  throw new Error(message)
}
