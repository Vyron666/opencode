import type {
  CreateElicitationResponse,
  PromptResponse,
  SetSessionConfigOptionResponse,
  SetSessionModeResponse,
  SetSessionModelResponse,
} from "@agentclientprotocol/sdk"
import { toElicitationContent } from "../runtime/runtime-types"
import { beginPromptTrace, clearPromptTrace, failPromptTrace, finishPromptTrace, recordPromptEventTrace } from "./worker-agent-prompt-observe"
import {
  findRuntimeByBusinessSessionId,
  findRuntimeByPermissionRequestId,
  findRuntimeByQuestionRequestId,
  forgetRuntime,
  rememberRuntime,
  requireRuntime,
  requireString,
} from "./worker-agent-store"
import { createRuntimeEntry, isPromptInterrupted, toBootstrap, updateSnapshot } from "./worker-agent-runtime-support"
import { createLogger } from "../log"

const log = createLogger("worker-agent-runtime")

export function createRuntimeHandlers(input: {
  runtimeShellBaseUrl: string
  workerToken: string
}) {
  return {
    openSession,
    loadSession,
    resumeSession,
    forkSession,
    sendPrompt,
    cancelPrompt,
    closeSession,
    setMode,
    setModel,
    setConfig,
    resolvePermission,
    resolveQuestion,
  }

  async function openSession(body: Record<string, unknown>) {
    const businessSessionId = requireString(body.businessSessionId, "businessSessionId")
    const workspacePath = requireString(body.workspacePath, "workspacePath")
    const sandboxPath = typeof body.sandboxPath === "string" ? body.sandboxPath : workspacePath
    const workerId = requireString(body.workerId, "workerId")
    const existing = findRuntimeByBusinessSessionId(businessSessionId)
    if (existing) return toBootstrap(existing)
    const entry = createRuntimeEntry({
      runtimeShellBaseUrl: input.runtimeShellBaseUrl,
      workerToken: input.workerToken,
      businessSessionId,
      workspacePath,
      sandboxPath,
      workerId,
      configContent: typeof body.configContent === "string" ? body.configContent : undefined,
    })
    const response = await openRuntimeEntry(entry, () => entry.client.newSession(sandboxPath)).catch((error) => {
      log.warn("worker open session failed", {
        businessSessionId,
        workerId,
        workspacePath,
        sandboxPath,
        message: error instanceof Error ? error.message : String(error),
      })
      throw error
    })
    updateSnapshot(entry, response)
    rememberRuntime(entry)
    return toBootstrap(entry)
  }

  async function loadSession(body: Record<string, unknown>) {
    const businessSessionId = requireString(body.businessSessionId, "businessSessionId")
    const workspacePath = requireString(body.workspacePath, "workspacePath")
    const sandboxPath = typeof body.sandboxPath === "string" ? body.sandboxPath : workspacePath
    const workerId = requireString(body.workerId, "workerId")
    const acpSessionId = requireString(body.acpSessionId, "acpSessionId")
    const existing = findRuntimeByBusinessSessionId(businessSessionId)
    if (existing && existing.client.getSessionId() === acpSessionId) return toBootstrap(existing)
    const entry = createRuntimeEntry({
      runtimeShellBaseUrl: input.runtimeShellBaseUrl,
      workerToken: input.workerToken,
      businessSessionId,
      workspacePath,
      sandboxPath,
      workerId,
      configContent: typeof body.configContent === "string" ? body.configContent : undefined,
    })
    const response = await openRuntimeEntry(entry, () => entry.client.loadSession(sandboxPath, acpSessionId)).catch((error) => {
      log.warn("worker load session failed", {
        businessSessionId,
        workerId,
        workspacePath,
        sandboxPath,
        acpSessionId,
        message: error instanceof Error ? error.message : String(error),
      })
      throw error
    })
    updateSnapshot(entry, response)
    rememberRuntime(entry)
    return toBootstrap(entry)
  }

  async function resumeSession(body: Record<string, unknown>) {
    const businessSessionId = requireString(body.businessSessionId, "businessSessionId")
    const workspacePath = requireString(body.workspacePath, "workspacePath")
    const sandboxPath = typeof body.sandboxPath === "string" ? body.sandboxPath : workspacePath
    const workerId = requireString(body.workerId, "workerId")
    const acpSessionId = requireString(body.acpSessionId, "acpSessionId")
    const existing = findRuntimeByBusinessSessionId(businessSessionId)
    if (existing && existing.client.getSessionId() === acpSessionId) return toBootstrap(existing)
    const entry = createRuntimeEntry({
      runtimeShellBaseUrl: input.runtimeShellBaseUrl,
      workerToken: input.workerToken,
      businessSessionId,
      workspacePath,
      sandboxPath,
      workerId,
      configContent: typeof body.configContent === "string" ? body.configContent : undefined,
    })
    const response = await openRuntimeEntry(entry, () => entry.client.resumeSession(sandboxPath, acpSessionId)).catch((error) => {
      log.warn("worker resume session failed", {
        businessSessionId,
        workerId,
        workspacePath,
        sandboxPath,
        acpSessionId,
        message: error instanceof Error ? error.message : String(error),
      })
      throw error
    })
    updateSnapshot(entry, response)
    rememberRuntime(entry)
    return toBootstrap(entry)
  }

  async function forkSession(body: Record<string, unknown>) {
    const businessSessionId = requireString(body.businessSessionId, "businessSessionId")
    const workspacePath = requireString(body.workspacePath, "workspacePath")
    const sandboxPath = typeof body.sandboxPath === "string" ? body.sandboxPath : workspacePath
    const workerId = requireString(body.workerId, "workerId")
    const sourceAcpSessionId = requireString(body.sourceAcpSessionId, "sourceAcpSessionId")
    const entry = createRuntimeEntry({
      runtimeShellBaseUrl: input.runtimeShellBaseUrl,
      workerToken: input.workerToken,
      businessSessionId,
      workspacePath,
      sandboxPath,
      workerId,
      configContent: typeof body.configContent === "string" ? body.configContent : undefined,
    })
    const response = await openRuntimeEntry(entry, () => entry.client.forkSession(sandboxPath, sourceAcpSessionId)).catch((error) => {
      log.warn("worker fork session failed", {
        businessSessionId,
        workerId,
        workspacePath,
        sandboxPath,
        sourceAcpSessionId,
        message: error instanceof Error ? error.message : String(error),
      })
      throw error
    })
    updateSnapshot(entry, response)
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
    try {
      await entry.client.close()
    } finally {
      await entry.closeSandbox?.()
    }
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
}

async function openRuntimeEntry<T>(entry: ReturnType<typeof createRuntimeEntry>, open: () => Promise<T>) {
  try {
    return await open()
  } catch (error) {
    entry.closing = true
    await entry.client.close().catch(() => {})
    await entry.closeSandbox?.().catch(() => {})
    throw error
  }
}
