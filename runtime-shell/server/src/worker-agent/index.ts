import type {
  CreateElicitationResponse,
  PromptResponse,
  SetSessionConfigOptionResponse,
  SetSessionModeResponse,
  SetSessionModelResponse,
} from "@agentclientprotocol/sdk"
import { AcpProcessClient } from "../acp/acp-process-client"
import { createLogger } from "../log"
import type { SessionEvent } from "../types"
import { toElicitationContent } from "../runtime/runtime-types"
import { beginPromptTrace, clearPromptTrace, failPromptTrace, finishPromptTrace, recordPromptEventTrace } from "./worker-agent-prompt-observe"
import { queryFailure, queryHeartbeat, queryLease, queryRuntime, toBootstrap } from "./worker-agent-query"
import {
  findRuntimeByBusinessSessionId,
  findRuntimeByPermissionRequestId,
  findRuntimeByQuestionRequestId,
  forgetRuntime,
  rememberRuntime,
  requireRuntime,
  requireString,
} from "./worker-agent-store"
import type { RuntimeEntry, RuntimeSnapshot } from "./worker-agent-types"

const log = createLogger("worker-agent")
const token = process.env.RUNTIME_SHELL_WORKER_AGENT_TOKEN || "change-me-worker-agent"
const port = Number(process.env.RUNTIME_SHELL_WORKER_AGENT_PORT || "4097")
const runtimeShellBaseUrl = (process.env.RUNTIME_SHELL_INTERNAL_BASE_URL || "http://runtime-shell:3000").replace(/\/+$/, "")

Bun.serve({
  port,
  hostname: "0.0.0.0",
  idleTimeout: 120,
  fetch: async (request) => {
    try {
      if (!isAuthorized(request)) {
        return json({ message: "unauthorized" }, 401)
      }
      const url = new URL(request.url)
      if (request.method === "GET" && url.pathname === "/healthz") {
        return json({ success: true })
      }
      if (request.method === "GET" && url.pathname === "/runtime/query-runtime") {
        return json(queryRuntime(url))
      }
      if (request.method === "GET" && url.pathname === "/runtime/query-lease") {
        return json(queryLease(url))
      }
      if (request.method === "GET" && url.pathname === "/runtime/query-heartbeat") {
        return json(queryHeartbeat(url))
      }
      if (request.method === "GET" && url.pathname === "/runtime/query-failure") {
        return json(queryFailure(url))
      }
      if (request.method !== "POST") {
        return json({ message: "method not allowed" }, 405)
      }
      if (url.pathname === "/runtime/open-session") {
        return json(await openSession(await request.json()))
      }
      if (url.pathname === "/runtime/load-session") {
        return json(await loadSession(await request.json()))
      }
      if (url.pathname === "/runtime/resume-session") {
        return json(await resumeSession(await request.json()))
      }
      if (url.pathname === "/runtime/fork-session") {
        return json(await forkSession(await request.json()))
      }
      if (url.pathname === "/runtime/send-prompt") {
        return json(await sendPrompt(await request.json()))
      }
      if (url.pathname === "/runtime/cancel-prompt") {
        await cancelPrompt(await request.json())
        return json({ success: true })
      }
      if (url.pathname === "/runtime/close-session") {
        await closeSession(await request.json())
        return json({ success: true })
      }
      if (url.pathname === "/runtime/set-mode") {
        return json(await setMode(await request.json()))
      }
      if (url.pathname === "/runtime/set-model") {
        return json(await setModel(await request.json()))
      }
      if (url.pathname === "/runtime/set-config") {
        return json(await setConfig(await request.json()))
      }
      if (url.pathname === "/runtime/resolve-permission") {
        await resolvePermission(await request.json())
        return json({ success: true })
      }
      if (url.pathname === "/runtime/resolve-question") {
        await resolveQuestion(await request.json())
        return json({ success: true })
      }
      return json({ message: "not found" }, 404)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.warn("worker agent request failed", { message })
      return json({ message }, 500)
    }
  },
})

log.info("worker agent started", { port, runtimeShellBaseUrl })

function isAuthorized(request: Request) {
  return request.headers.get("x-runtime-worker-token") === token
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  })
}

async function openSession(body: Record<string, unknown>) {
  const businessSessionId = requireString(body.businessSessionId, "businessSessionId")
  const workspacePath = requireString(body.workspacePath, "workspacePath")
  const workerId = requireString(body.workerId, "workerId")
  const existing = findRuntimeByBusinessSessionId(businessSessionId)
  if (existing) {
    return toBootstrap(existing)
  }
  const entry = createRuntimeEntry({ businessSessionId, workspacePath, workerId })
  const response = await entry.client.newSession(workspacePath)
  entry.snapshot = {
    configOptions: response.configOptions,
    models: response.models,
    modes: response.modes,
  }
  rememberRuntime(entry)
  return toBootstrap(entry)
}

async function loadSession(body: Record<string, unknown>) {
  const businessSessionId = requireString(body.businessSessionId, "businessSessionId")
  const workspacePath = requireString(body.workspacePath, "workspacePath")
  const workerId = requireString(body.workerId, "workerId")
  const acpSessionId = requireString(body.acpSessionId, "acpSessionId")
  const existing = findRuntimeByBusinessSessionId(businessSessionId)
  if (existing && existing.client.getSessionId() === acpSessionId) {
    return toBootstrap(existing)
  }
  const entry = createRuntimeEntry({ businessSessionId, workspacePath, workerId })
  const response = await entry.client.loadSession(workspacePath, acpSessionId)
  entry.snapshot = {
    configOptions: response.configOptions,
    models: response.models,
    modes: response.modes,
  }
  rememberRuntime(entry)
  return toBootstrap(entry)
}

async function resumeSession(body: Record<string, unknown>) {
  const businessSessionId = requireString(body.businessSessionId, "businessSessionId")
  const workspacePath = requireString(body.workspacePath, "workspacePath")
  const workerId = requireString(body.workerId, "workerId")
  const acpSessionId = requireString(body.acpSessionId, "acpSessionId")
  const existing = findRuntimeByBusinessSessionId(businessSessionId)
  if (existing && existing.client.getSessionId() === acpSessionId) {
    return toBootstrap(existing)
  }
  const entry = createRuntimeEntry({ businessSessionId, workspacePath, workerId })
  const response = await entry.client.resumeSession(workspacePath, acpSessionId)
  entry.snapshot = {
    configOptions: response.configOptions,
    models: response.models,
    modes: response.modes,
  }
  rememberRuntime(entry)
  return toBootstrap(entry)
}

async function forkSession(body: Record<string, unknown>) {
  const businessSessionId = requireString(body.businessSessionId, "businessSessionId")
  const workspacePath = requireString(body.workspacePath, "workspacePath")
  const workerId = requireString(body.workerId, "workerId")
  const sourceAcpSessionId = requireString(body.sourceAcpSessionId, "sourceAcpSessionId")
  const entry = createRuntimeEntry({ businessSessionId, workspacePath, workerId })
  const response = await entry.client.forkSession(workspacePath, sourceAcpSessionId)
  entry.snapshot = {
    configOptions: response.configOptions,
    models: response.models,
    modes: response.modes,
  }
  rememberRuntime(entry)
  return toBootstrap(entry)
}

async function sendPrompt(body: Record<string, unknown>) {
  const entry = requireRuntime(body.remoteRuntimeId)
  const parts = Array.isArray(body.parts) ? body.parts : []
  beginPromptTrace(entry, parts.length)
  try {
    const response = await entry.client.prompt(parts)
    await entry.client.flushPendingEvents()
    finishPromptTrace(entry, response.stopReason)
    return response satisfies PromptResponse
  } catch (error) {
    if (isPromptInterrupted(error)) throw error
    entry.lastFailure = {
      at: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
      detail: {
        source: "send_prompt",
      },
    }
    failPromptTrace(entry, error instanceof Error ? error.message : String(error))
    throw error
  } finally {
    clearPromptTrace(entry)
  }
}

async function cancelPrompt(body: Record<string, unknown>) {
  const entry = requireRuntime(body.remoteRuntimeId)
  await entry.client.cancel()
}

async function closeSession(body: Record<string, unknown>) {
  const entry = requireRuntime(body.remoteRuntimeId)
  entry.closing = true
  forgetRuntime(entry)
  await entry.client.close()
}

async function setMode(body: Record<string, unknown>) {
  const entry = requireRuntime(body.remoteRuntimeId)
  const modeId = requireString(body.modeId, "modeId")
  const response = await entry.client.setSessionMode(modeId)
  updateSnapshot(entry, response as Record<string, unknown>)
  return response satisfies SetSessionModeResponse
}

async function setModel(body: Record<string, unknown>) {
  const entry = requireRuntime(body.remoteRuntimeId)
  const modelId = requireString(body.modelId, "modelId")
  const response = await entry.client.setSessionModel(modelId)
  updateSnapshot(entry, response as Record<string, unknown>)
  return response satisfies SetSessionModelResponse
}

async function setConfig(body: Record<string, unknown>) {
  const entry = requireRuntime(body.remoteRuntimeId)
  const configId = requireString(body.configId, "configId")
  const response = await entry.client.setSessionConfigOption(configId, body.value as string | boolean)
  updateSnapshot(entry, response as Record<string, unknown>)
  return response satisfies SetSessionConfigOptionResponse
}

async function resolvePermission(body: Record<string, unknown>) {
  const requestId = requireString(body.requestId, "requestId")
  const entry = findRuntimeByPermissionRequestId(requestId)
  if (!entry) throw new Error(`permission request not found: ${requestId}`)
  const approved = Boolean(body.approved)
  const optionId = typeof body.optionId === "string" ? body.optionId : undefined
  const ok = approved && optionId
    ? entry.client.resolvePermission(requestId, optionId)
    : entry.client.rejectPermission(requestId)
  if (!ok) throw new Error(`failed to resolve permission: ${requestId}`)
  entry.pendingPermissions.delete(requestId)
}

async function resolveQuestion(body: Record<string, unknown>) {
  const requestId = requireString(body.requestId, "requestId")
  const entry = findRuntimeByQuestionRequestId(requestId)
  if (!entry) throw new Error(`question request not found: ${requestId}`)
  const action = requireString(body.action, "action")
  const response: CreateElicitationResponse =
    action === "accept"
      ? { action: "accept", content: toElicitationContent((body.content as Record<string, unknown> | undefined) ?? {}) }
      : action === "decline"
        ? { action: "decline" }
        : { action: "cancel" }
  const ok = entry.client.resolveQuestion(requestId, response)
  if (!ok) throw new Error(`failed to resolve question: ${requestId}`)
  entry.pendingQuestions.delete(requestId)
}

function createRuntimeEntry(input: { businessSessionId: string; workspacePath: string; workerId: string }) {
  const remoteRuntimeId = `rrt_${crypto.randomUUID().replace(/-/g, "")}`
  const entry: RuntimeEntry = {
    remoteRuntimeId,
    businessSessionId: input.businessSessionId,
    workerId: input.workerId,
    workspacePath: input.workspacePath,
    client: new AcpProcessClient(
      {
        cwd: input.workspacePath,
        businessSessionId: input.businessSessionId,
        workerId: input.workerId,
        onEvent: async (event) => {
          await pushEvent(entry, event)
        },
      },
      () => Promise.resolve(),
    ),
    snapshot: {},
    closing: false,
    openedAt: new Date().toISOString(),
    pendingPermissions: new Map(),
    pendingQuestions: new Map(),
  }
  entry.client.onPermissionRequested((permission) => {
    entry.pendingPermissions.set(permission.requestId, permission)
  })
  entry.client.onQuestionRequested((question) => {
    entry.pendingQuestions.set(question.requestId, question)
  })
  entry.client.onExit((code, signal) => {
    forgetRuntime(entry)
    if (entry.closing) return
    entry.lastFailure = {
      at: new Date().toISOString(),
      message: "ACP runtime exited unexpectedly",
      detail: { code, signal, source: "process_exit" },
    }
    void pushEvent(entry, {
      eventId: `evt_${crypto.randomUUID().replace(/-/g, "")}`,
      eventType: "worker_disconnected",
      businessSessionId: entry.businessSessionId,
      acpSessionId: entry.client.getSessionId(),
      workerId: entry.workerId,
      timestamp: new Date().toISOString(),
      payload: {
        code,
        signal,
        message: "ACP runtime exited unexpectedly",
      },
    })
  })
  return entry
}

function updateSnapshot(entry: RuntimeEntry, response: Record<string, unknown>) {
  entry.snapshot = {
    configOptions: Array.isArray(response.configOptions)
      ? (response.configOptions as RuntimeSnapshot["configOptions"])
      : entry.snapshot.configOptions,
    models: response.models && typeof response.models === "object"
      ? (response.models as RuntimeSnapshot["models"])
      : entry.snapshot.models,
    modes: response.modes && typeof response.modes === "object"
      ? (response.modes as RuntimeSnapshot["modes"])
      : entry.snapshot.modes,
  }
}

async function pushEvent(entry: RuntimeEntry, event: SessionEvent) {
  entry.lastEventAt = event.timestamp
  recordPromptEventTrace(entry, event)
  const requestId = typeof event.payload.requestId === "string" ? event.payload.requestId : undefined
  const payload = {
    event,
    pendingPermission:
      event.eventType === "permission_requested" && requestId
        ? entry.pendingPermissions.get(requestId)
        : undefined,
    pendingQuestion:
      event.eventType === "question_requested" && requestId
        ? entry.pendingQuestions.get(requestId)
        : undefined,
  }
  const response = await fetch(`${runtimeShellBaseUrl}/api/internal/runtime/event-push`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-runtime-worker-token": token,
    },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    const responseText = await response.text()
    entry.lastFailure = {
      at: new Date().toISOString(),
      message: `failed to push runtime event: ${response.status}`,
      detail: { response: responseText, source: "event_push" },
    }
    throw new Error(`failed to push runtime event: ${response.status} ${responseText}`)
  }
}

function isPromptInterrupted(error: unknown) {
  if (!(error instanceof Error)) return false
  return error.name === "MessageAbortedError" || /aborted|cancelled|canceled|runtime (closed|exited)/i.test(error.message)
}
