const baseUrl = process.env.RUNTIME_SHELL_WEB_CONVERSATION_BASE_URL || "http://127.0.0.1:3100"
const username = process.env.RUNTIME_SHELL_WEB_CONVERSATION_USERNAME || "admin"
const password = process.env.RUNTIME_SHELL_WEB_CONVERSATION_PASSWORD || "change-me"
const pageLoadTimeoutMs = 45000
const apiTimeoutMs = 45000
const promptTimeoutMs = 45000
const slowPromptTimeoutMs = 70000

const { chromium } = await import("playwright")

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
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

  const workspaceName = `Conversation Workspace ${Date.now()}`
  const workspaceId = await createWorkspaceFromSidebar(page, workspaceName)
  result.assertions.workspace_created = Boolean(workspaceId)
  assert(result.assertions.workspace_created, "workspace should be created")
  result.steps.push("workspace create ok")

  const sessionTitle = `Conversation Flow ${Date.now()}`
  const sessionId = await createSessionFromSidebar(page, sessionTitle)
  await selectSessionFromSidebar(page, sessionTitle)
  const activeSession = await waitForSessionDetail(page, sessionId, (session) => session?.status === "active", promptTimeoutMs)
  result.assertions.session_activated = activeSession.session?.status === "active"
  assert(result.assertions.session_activated, "session should become active")
  result.steps.push("session create and activate ok")

  const modelOptions = await readModelOptions(page, sessionId)
  result.assertions.model_option_count = modelOptions.length
  result.assertions.deepseek_visible = modelOptions.some((item) => /deepseek/i.test(item.value) || /deepseek/i.test(item.text))
  assert(result.assertions.model_option_count >= 1, "settings should show available models")
  assert(result.assertions.deepseek_visible, "settings should include a DeepSeek option")
  result.steps.push("settings model list ok")

  const pingToken = `PING-${Date.now()}`
  await sendPrompt(page, `请只回复一行 ${pingToken}，不要解释。`)
  await waitForAssistantText(page, pingToken, promptTimeoutMs)
  const pingDetail = await waitForSessionDetail(
    page,
    sessionId,
    (session, data) => session?.eventCount >= 1 && data.events.some((event) => event.eventType === "turn_completed"),
    promptTimeoutMs,
  )
  result.assertions.normal_reply_visible = (await readMainText(page)).includes(pingToken)
  result.assertions.normal_turn_completed = pingDetail.events.some((event) => event.eventType === "turn_completed")
  assert(result.assertions.normal_reply_visible, "chat should render the full assistant reply")
  assert(result.assertions.normal_turn_completed, "session detail should contain turn_completed after a normal reply")
  result.steps.push("normal reply render ok")

  await page.reload({ waitUntil: "domcontentloaded" })
  await waitFor(async () => (await readMainText(page)).includes(pingToken), "assistant reply should survive a page reload", promptTimeoutMs)
  result.assertions.reply_survives_reload = (await readMainText(page)).includes(pingToken)
  assert(result.assertions.reply_survives_reload, "assistant reply should survive a page reload")
  result.steps.push("reply replay after reload ok")

  const planToken = `PLAN-${Date.now()}`
  const beforePlanDetail = await readSessionDetail(page, sessionId)
  await sendPrompt(page, `请先给出一个两步计划，并且在计划说明里包含 ${planToken}，然后再用一句话结束。`)
  await waitForTurnToSettle(page, sessionId, beforePlanDetail.events.length, slowPromptTimeoutMs)
  const planDetail = await readSessionDetail(page, sessionId)
  const planEvents = planDetail.events.slice(beforePlanDetail.events.length)
  result.assertions.plan_turn_completed = planEvents.some((event) => event.eventType === "turn_completed")
  assert(result.assertions.plan_turn_completed, "plan-oriented flow should still publish turn_completed")

  const emittedPlan = planEvents.some((event) => event.eventType === "plan")
  result.assertions.plan_event_emitted = emittedPlan
  if (emittedPlan) {
    await waitFor(async () => (await readMainText(page)).includes(planToken), "plan output should render in the chat", slowPromptTimeoutMs)
    result.assertions.plan_visible = (await readMainText(page)).includes(planToken)
    assert(result.assertions.plan_visible, "chat should render the plan content")
    result.steps.push("plan render ok")

    await page.reload({ waitUntil: "domcontentloaded" })
    await waitFor(async () => (await readMainText(page)).includes(planToken), "plan content should survive a page reload", slowPromptTimeoutMs)
    result.assertions.plan_survives_reload = (await readMainText(page)).includes(planToken)
    assert(result.assertions.plan_survives_reload, "plan content should survive a page reload")
    result.steps.push("plan replay after reload ok")
  }

  result.assertions.permission_requested = await requestPermissionFlow(page, sessionId)
  assert(result.assertions.permission_requested, "permission request should appear")

  const rejectedCount = await rejectAllVisiblePermissionRequests(page, sessionId, 3)
  result.assertions.permission_rejections = rejectedCount
  result.assertions.permission_cleared = rejectedCount > 0
  assert(result.assertions.permission_cleared, "at least one permission request should be rejected in the browser flow")

  await waitFor(async () => {
    const mainText = await readMainText(page)
    if (mainText.includes("等待权限审批")) return false
    const detail = await readSessionDetail(page, sessionId)
    return Array.isArray(detail.events) && (detail.session?.pendingPermissions || []).length === 0
  }, "permission waiting state should clear after rejection flow", 30000)

  const mainAfterPermission = await readMainText(page)
  result.assertions.permission_waiting_cleared = !mainAfterPermission.includes("等待权限审批")
  assert(result.assertions.permission_waiting_cleared, "composer should leave waiting-permission state after rejection flow")
  result.steps.push("permission convergence ok")

  const todoSessionTitle = `Todo Flow ${Date.now()}`
  const todoSessionId = await createSessionFromSidebar(page, todoSessionTitle)
  await selectSessionFromSidebar(page, todoSessionTitle)
  const todoActiveSession = await waitForSessionDetail(page, todoSessionId, (session) => session?.status === "active", 30000)
  result.assertions.todo_session_activated = todoActiveSession.session?.status === "active"
  assert(result.assertions.todo_session_activated, "todo verification session should become active")

  await seedInternalEvent({
    page,
    sessionId: todoSessionId,
    event: createSyntheticEvent(todoSessionId, "plan", {
      entries: [
        { content: "collect runtime logs", status: "pending" },
        { content: "verify browser state", status: "in_progress" },
      ],
    }),
    testAutoResolve: {
      question: {
        action: "accept",
        content: {},
      },
    },
  })
  await waitFor(async () => {
    const mainText = await readMainText(page)
    return mainText.includes("collect runtime logs") && mainText.includes("verify browser state")
  }, "todo plan content should render in the chat", 15000)
  result.assertions.todo_render_visible = (await readMainText(page)).includes("collect runtime logs")
  assert(result.assertions.todo_render_visible, "todo plan should render visible items in the chat")

  await seedInternalEvent({
    page,
    sessionId: todoSessionId,
    event: createSyntheticEvent(todoSessionId, "plan", {
      entries: [
        { content: "collect runtime logs", status: "completed" },
        { content: "verify browser state", status: "completed" },
        { content: "ship regression", status: "in_progress" },
      ],
    }),
  })
  await waitFor(async () => {
    const mainText = await readMainText(page)
    return mainText.includes("ship regression") && !mainText.includes("Updating todos...")
  }, "todo plan update should refresh the chat block", 15000)
  result.assertions.todo_update_visible = (await readMainText(page)).includes("ship regression")
  assert(result.assertions.todo_update_visible, "updated todo items should refresh in place")

  await page.reload({ waitUntil: "domcontentloaded" })
  await waitFor(async () => {
    const mainText = await readMainText(page)
    return mainText.includes("collect runtime logs") && mainText.includes("ship regression")
  }, "todo plan content should survive a page reload", 15000)
  const mainAfterTodoReload = await readMainText(page)
  result.assertions.todo_survives_reload =
    mainAfterTodoReload.includes("collect runtime logs") &&
    mainAfterTodoReload.includes("ship regression")
  assert(result.assertions.todo_survives_reload, "todo plan content should survive a page reload")
  result.steps.push("todo render and replay ok")

  const toolSessionTitle = `Tool Flow ${Date.now()}`
  const toolSessionId = await createSessionFromSidebar(page, toolSessionTitle)
  await selectSessionFromSidebar(page, toolSessionTitle)
  const toolActiveSession = await waitForSessionDetail(page, toolSessionId, (session) => session?.status === "active", 30000)
  result.assertions.tool_session_activated = toolActiveSession.session?.status === "active"
  assert(result.assertions.tool_session_activated, "tool verification session should become active")

  const toolCallId = `tool_${Date.now()}`
  await seedInternalEvent({
    page,
    sessionId: toolSessionId,
    event: createSyntheticEvent(toolSessionId, "tool_call", {
      toolCallId,
      title: "read",
      kind: "read",
      status: "pending",
      rawInput: { filePath: "/workspace/README.md" },
      locations: [{ path: "/workspace/README.md" }],
    }),
  })
  await seedInternalEvent({
    page,
    sessionId: toolSessionId,
    event: createSyntheticEvent(toolSessionId, "tool_call_update", {
      toolCallId,
      title: "read",
      kind: "read",
      status: "completed",
      rawInput: { filePath: "/workspace/README.md" },
      rawOutput: "hello world",
      locations: [{ path: "/workspace/README.md", line: 1 }],
    }),
  })
  await waitFor(async () => {
    const mainText = await readMainText(page)
    return mainText.includes("COMPLETED") && mainText.includes("read")
  }, "tool block should render in the chat", 15000)
  const expandToolButton = page.locator("main").getByRole("button", { name: /展开工具结果|收起工具结果/ }).first()
  if (await expandToolButton.isVisible().catch(() => false)) {
    const buttonText = await expandToolButton.innerText().catch(() => "")
    if (buttonText.includes("展开")) await expandToolButton.click()
  }
  await waitFor(async () => {
    const mainText = await readMainText(page)
    return mainText.includes("README.md")
  }, "expanded tool details should render in the chat", 15000)
  const mainAfterToolExpand = await readMainText(page)
  result.assertions.tool_render_visible = mainAfterToolExpand.includes("README.md")
  result.assertions.tool_output_visible = mainAfterToolExpand.includes("hello world")
  assert(result.assertions.tool_render_visible, "expanded tool output should render in the chat")

  await page.reload({ waitUntil: "domcontentloaded" })
  await waitFor(async () => {
    const mainText = await readMainText(page)
    return mainText.includes("COMPLETED") && mainText.includes("read")
  }, "tool block should survive a page reload", 15000)
  result.assertions.tool_survives_reload = (await readMainText(page)).includes("COMPLETED") && (await readMainText(page)).includes("read")
  assert(result.assertions.tool_survives_reload, "tool block should survive a page reload")
  result.steps.push("tool render and replay ok")

  const questionSessionTitle = `Question Flow ${Date.now()}`
  const questionSessionId = await createSessionFromSidebar(page, questionSessionTitle)
  await selectSessionFromSidebar(page, questionSessionTitle)
  const questionActiveSession = await waitForSessionDetail(page, questionSessionId, (session) => session?.status === "active", 30000)
  result.assertions.question_session_activated = questionActiveSession.session?.status === "active"
  assert(result.assertions.question_session_activated, "question verification session should become active")

  const questionRequestId = `q_${Date.now()}`
  await seedInternalEvent({
    page,
    sessionId: questionSessionId,
    pendingQuestion: {
      requestId: questionRequestId,
      businessSessionId: questionSessionId,
      acpSessionId: "ses_test",
      workerId: "worker_local",
      message: "请选择是否继续",
      mode: "form",
      requestedSchema: null,
      createdAt: new Date().toISOString(),
    },
    event: createSyntheticEvent(questionSessionId, "question_requested", {
      requestId: questionRequestId,
      message: "请选择是否继续",
      requestedSchema: null,
    }),
    testAutoResolve: {
      question: {
        action: "accept",
        content: {},
      },
    },
  })
  await waitForQuestionControls(page, 15000)
  result.assertions.question_requested = (await readMainText(page)).includes("请选择是否继续")
  assert(result.assertions.question_requested, "question request should render in the chat")

  const questionSubmitButton = page.locator("main").getByRole("button", { name: /^提交$/ }).first()
  await questionSubmitButton.click()
  await waitFor(async () => {
    const mainText = await readMainText(page)
    if (mainText.includes("等待问题回答")) return false
    const detail = await readSessionDetail(page, questionSessionId)
    return (detail.session?.pendingQuestions || []).length === 0
  }, "question waiting state should clear after submission", 30000)
  const mainAfterQuestion = await readMainText(page)
  result.assertions.question_waiting_cleared = !mainAfterQuestion.includes("等待问题回答")
  assert(result.assertions.question_waiting_cleared, "question submission should clear the waiting-question phase")
  result.steps.push("question convergence ok")

  result.ok = true
} finally {
  console.log(JSON.stringify(result, null, 2))
  await context.close()
  await browser.close()
}

async function login(page, username, password) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: pageLoadTimeoutMs })
  const form = page.locator("form").first()
  await form.locator("input").nth(0).fill(username)
  await form.locator("input").nth(1).fill(password)
  await form.locator('button[type="submit"]').click()
  await waitFor(async () => await page.locator("aside").last().isVisible().catch(() => false), "login should finish", 30000)
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

async function readModelOptions(page, sessionId) {
  const drawer = await openSettingsDrawer(page)
  const modelSelect = page.locator("main select").nth(1)
  await waitFor(async () => {
    const detail = await readSessionDetail(page, sessionId)
    if (!detail.session?.capabilityState?.modelId) return false
    const options = await modelSelect.locator("option").evaluateAll((nodes) =>
      nodes.map((node) => ({
        value: node.getAttribute("value") || "",
        text: (node.textContent || "").trim(),
      })),
    )
    return options.some((item) => item.value)
  }, "model selector should contain real model options", 30000)
  const options = await modelSelect.locator("option").evaluateAll((nodes) =>
    nodes.map((node) => ({
      value: node.getAttribute("value") || "",
      text: (node.textContent || "").trim(),
    })),
  )
  await closeSettingsDrawer(page, drawer)
  return options
}

async function sendPrompt(page, text) {
  const main = page.locator("main")
  const submitButton = main.locator('button[type="submit"]')
  await waitFor(async () => await submitButton.isEnabled().catch(() => false), "submit button should become enabled", 30000)
  await main.locator("textarea").fill(text)
  await waitFor(async () => await submitButton.isEnabled().catch(() => false), "submit button should stay enabled after filling prompt", 5000)
  await submitButton.click()
}

async function waitForAssistantText(page, expectedText, timeoutMs) {
  await waitFor(async () => {
    const mainText = await readMainText(page)
    const sendButtonText = await readComposerButtonText(page)
    return mainText.includes(expectedText) && !/模型生成中|等待回答中|等待审批中/.test(sendButtonText)
  }, `assistant reply should render: ${expectedText}`, timeoutMs)
}

async function waitForPermissionState(page, sessionId, timeoutMs) {
  await waitFor(async () => {
    const mainText = await readMainText(page)
    if (mainText.includes("等待权限审批") || mainText.includes("权限请求")) return true
    const detail = await readSessionDetail(page, sessionId)
    return (detail.session?.pendingPermissions || []).length > 0
  }, "permission request should appear", timeoutMs)
}

async function requestPermissionFlow(page, sessionId) {
  const prompts = [
    "请调用读取目录的工具访问 /workspace；如果需要审批，请先发起权限请求并停在等待审批状态。",
    "请先尝试读取 /workspace 目录；如果工具需要权限，就立刻发起权限申请，不要继续回答。",
    "请读取 /workspace 目录，并在需要时先申请权限；权限弹出后先不要继续执行。",
  ]

  for (const prompt of prompts) {
    const beforeDetail = await readSessionDetail(page, sessionId)
    await sendPrompt(page, prompt)
    const requested = await waitForTruthy(async () => {
      const mainText = await readMainText(page)
      if (mainText.includes("等待权限审批") || mainText.includes("权限请求")) return true
      const detail = await readSessionDetail(page, sessionId)
      return (detail.session?.pendingPermissions || []).length > 0
    }, 12000)
    if (requested) {
      await waitForPermissionControls(page, 15000)
      return true
    }
    await waitForTurnToSettle(page, sessionId, beforeDetail.events.length, 30000)
  }

  return false
}

async function rejectAllVisiblePermissionRequests(page, sessionId, maxRejects) {
  let handled = 0
  while (handled < maxRejects) {
    await waitForPermissionControls(page, 15000).catch(() => false)
    const rejectButton = page.locator("main").getByRole("button", { name: /^拒绝$/ }).first()
    const visible = await rejectButton.isVisible().catch(() => false)
    if (!visible) break
    await rejectButton.click()
    handled += 1
    await waitFor(async () => {
      const detail = await readSessionDetail(page, sessionId)
      const pendingCount = (detail.session?.pendingPermissions || []).length
      const stillVisible = await rejectButton.isVisible().catch(() => false)
      return pendingCount === 0 || !stillVisible
    }, "permission rejection should settle", 15000)
    await page.waitForTimeout(800)
    const detail = await readSessionDetail(page, sessionId)
    if ((detail.session?.pendingPermissions || []).length === 0) break
  }
  return handled
}

async function waitForPermissionControls(page, timeoutMs) {
  await waitFor(async () => {
    const rejectButton = page.locator("main").getByRole("button", { name: /^拒绝$/ }).first()
    return await rejectButton.isVisible().catch(() => false)
  }, "permission controls should render in the chat", timeoutMs)
}

async function waitForQuestionControls(page, timeoutMs) {
  await waitFor(async () => {
    const submitButton = page.locator("main").getByRole("button", { name: /^提交$/ }).first()
    return await submitButton.isVisible().catch(() => false)
  }, "question controls should render in the chat", timeoutMs)
}

async function readSessionDetail(page, sessionId) {
  const detail = await api(page, `/api/session/detail?businessSessionId=${encodeURIComponent(sessionId)}`)
  return {
    session: detail.data.session || null,
    events: Array.isArray(detail.data.events) ? detail.data.events : [],
  }
}

async function waitForTurnToSettle(page, sessionId, previousEventCount, timeoutMs) {
  await waitFor(async () => {
    const detail = await readSessionDetail(page, sessionId)
    if (detail.events.length <= previousEventCount) return false
    return detail.events
      .slice(previousEventCount)
      .some((event) => event.eventType === "turn_completed" || event.eventType === "session_failed")
  }, `turn should settle for ${sessionId}`, timeoutMs)
}

async function waitForSessionDetail(page, sessionId, predicate, timeoutMs = 15000) {
  let latest = { session: null, events: [] }
  await waitFor(async () => {
    latest = await readSessionDetail(page, sessionId)
    return Boolean(predicate(latest.session, latest))
  }, `session detail did not satisfy predicate for ${sessionId}`, timeoutMs)
  return latest
}

async function readMainText(page) {
  return page.locator("main").innerText()
}

async function readComposerButtonText(page) {
  return page.locator("main button[type='submit']").innerText().catch(() => "")
}

async function openSettingsDrawer(page) {
  const drawer = page.locator("aside").filter({ has: page.getByRole("heading", { name: "运行设置" }) }).last()
  const visible = await drawer.isVisible().catch(() => false)
  if (!visible) {
    await page.locator("main header").getByRole("button", { name: "设置" }).click()
    await waitFor(async () => await drawer.isVisible().catch(() => false), "settings drawer should open", 15000)
  }
  return drawer
}

async function closeSettingsDrawer(page, drawer) {
  const closeButton = drawer.getByRole("button", { name: "关闭设置" })
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click()
    await waitFor(async () => !(await drawer.isVisible().catch(() => false)), "settings drawer should close", 15000)
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

async function selectSessionFromSidebar(page, sessionTitle) {
  const sidebar = page.locator("aside").first()
  const card = sidebar.getByRole("button", { name: new RegExp(escapeRegExp(sessionTitle)) }).first()
  await waitFor(async () => await card.isVisible().catch(() => false), `session card should be selectable: ${sessionTitle}`, 15000)
  await card.click()
  await page.waitForTimeout(1200)
}

async function api(page, path, init = {}) {
  const response = await page.context().request.fetch(new URL(path, baseUrl).toString(), {
    method: init.method || "GET",
    timeout: apiTimeoutMs,
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

async function seedInternalEvent({ page, sessionId, event, pendingQuestion, pendingPermission, testAutoResolve }) {
  const response = await page.context().request.fetch(new URL("/api/internal/runtime/event-push", baseUrl).toString(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-runtime-worker-token": "change-me-worker-agent",
    },
    data: {
      event,
      ...(pendingQuestion ? { pendingQuestion } : {}),
      ...(pendingPermission ? { pendingPermission } : {}),
      ...(testAutoResolve ? { testAutoResolve } : {}),
    },
  })
  const body = await response.json()
  if (response.status() !== 200 || body.code !== 0) {
    throw new Error(`internal event push failed: status=${response.status()} body=${JSON.stringify(body)}`)
  }
  await waitFor(async () => {
    const detail = await readSessionDetail(page, sessionId)
    return detail.events.some((item) => item.eventId === event.eventId)
  }, `synthetic event should persist for ${sessionId}`, 15000)
}

function createSyntheticEvent(sessionId, eventType, payload) {
  return {
    eventId: `evt_test_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    eventType,
    businessSessionId: sessionId,
    acpSessionId: "ses_test",
    workerId: "worker_local",
    timestamp: new Date().toISOString(),
    payload,
  }
}

async function waitFor(check, message, timeoutMs = 12000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(message)
}

async function waitForTruthy(check, timeoutMs = 12000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const value = await check()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return false
}

function assert(condition, message) {
  if (condition) return
  throw new Error(message)
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
