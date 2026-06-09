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
  findRuntimeById,
  findRuntimeByPermissionRequestId,
  findRuntimeByQuestionRequestId,
  forgetRuntime,
  rememberRuntime,
  rememberRuntimeClaim,
  releaseRuntimeClaim,
  requireRuntime,
  requireString,
} from "./worker-agent-store"
import { createRuntimeEntry, isPromptInterrupted, toBootstrap, updateSnapshot } from "./worker-agent-runtime-support"
import { prewarmSessionRuntimeOnWorker, tryOpenWarmRuntimeEntry } from "./worker-agent-warm-runtime"
import type { RuntimeEntry } from "./worker-agent-types"
import { closeOrphanDockerSandbox } from "./sandbox/docker-sandbox-manager"
import { buildColdRuntimeHomePath } from "./sandbox/docker-sandbox-runtime-home"
import { runAcpBootstrapGate } from "./sandbox/docker-sandbox-cold-start"
import { createLogger } from "../log"
import { buildRuntimeConfigContext } from "../runtime/runtime-config-content"
import { Config } from "../config"
import { rebuildMissingAcpSessionFromRuntimeHome } from "../services/runtime/runtime-session-rebuild-service"

const log = createLogger("worker-agent-runtime")
const pendingRuntimeBootstraps = new Map<string, Promise<ReturnType<typeof toBootstrap>>>()
const RUNTIME_OPEN_TIMEOUT_MS = Math.max(1_000, Config.workerAgentRequestTimeoutMs - 1_000)

type SessionRuntimeRequest = {
  businessSessionId: string
  workspaceId: string
  workspacePath: string
  sandboxPath: string
  workerId: string
  configContent?: string
  warmPoolTarget?: number
}

type SessionResumeRequest = SessionRuntimeRequest & {
  acpSessionId: string
}

type SessionForkRequest = SessionRuntimeRequest & {
  sourceAcpSessionId: string
  sourceBusinessSessionId?: string
  sourceRuntimeHomePath?: string
}

export function createRuntimeHandlers(input: {
  runtimeShellBaseUrl: string
  workerToken: string
}) {
  return {
    prewarmSession,
    openSession,
    loadSession,
    resumeSession,
    rebuildSession,
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

  async function prewarmSession(body: Record<string, unknown>) {
    const request = readSessionRuntimeRequest(body)
    await prewarmSessionRuntimeOnWorker({
      runtimeShellBaseUrl: input.runtimeShellBaseUrl,
      workerToken: input.workerToken,
      ...request,
    })
    return {
      warmed: true,
    }
  }

  async function openSession(body: Record<string, unknown>) {
    const request = readSessionRuntimeRequest(body)
    return openManagedSession(input, request, {
      action: "open",
      matchesExisting: () => true,
      warmStart: (entry, cwd) => entry.client.newSession(cwd),
      coldStart: (entry) => entry.client.newSession(request.sandboxPath),
    })
  }

  async function loadSession(body: Record<string, unknown>) {
    const request = readSessionResumeRequest(body)
    return openManagedSession(input, request, {
      action: "load",
      matchesExisting: (entry) => entry.client.getSessionId() === request.acpSessionId,
      warmStart: (entry, cwd) => entry.client.loadSession(cwd, request.acpSessionId),
      coldStart: (entry) => entry.client.loadSession(request.sandboxPath, request.acpSessionId),
    })
  }

  async function resumeSession(body: Record<string, unknown>) {
    const request = readSessionResumeRequest(body)
    return openManagedSession(input, request, {
      action: "resume",
      matchesExisting: (entry) => entry.client.getSessionId() === request.acpSessionId,
      warmStart: (entry, cwd) => entry.client.resumeSession(cwd, request.acpSessionId),
      coldStart: (entry) => entry.client.resumeSession(request.sandboxPath, request.acpSessionId),
    })
  }

  async function rebuildSession(body: Record<string, unknown>) {
    const request = readSessionResumeRequest(body)
    const rebuilt = await rebuildMissingAcpSessionFromRuntimeHome({
      session: {
        id: request.businessSessionId,
        workerId: request.workerId,
        workspaceId: request.workspaceId,
      },
      missingAcpSessionId: request.acpSessionId,
    })
    request.acpSessionId = rebuilt.sessionId
    return openManagedSession(input, request, {
      action: "load",
      matchesExisting: (entry) => entry.client.getSessionId() === request.acpSessionId,
      warmStart: (entry, cwd) => entry.client.loadSession(cwd, request.acpSessionId),
      coldStart: (entry) => entry.client.loadSession(request.sandboxPath, request.acpSessionId),
    })
  }

  async function forkSession(body: Record<string, unknown>) {
    const request = readSessionForkRequest(body)
    const liveSourceRuntime = request.sourceBusinessSessionId
      ? findRuntimeByBusinessSessionId(request.sourceBusinessSessionId)
      : undefined
    if (liveSourceRuntime) {
      return runRuntimeBootstrap(request.businessSessionId, async () => {
        const existing = findRuntimeByBusinessSessionId(request.businessSessionId)
        if (existing) return toBootstrap(existing)
        const sourceRuntimeHomePath = liveSourceRuntime.sandboxHandle?.runtimeHomePath
        if (!sourceRuntimeHomePath) {
          throw new Error("live fork source runtime home is unavailable")
        }
        const sourceRuntimeCwd = liveSourceRuntime.sandboxHandle?.runtimeCwd
          || liveSourceRuntime.sandboxPath
          || liveSourceRuntime.workspacePath
        const forked = await liveSourceRuntime.client.forkSession(
          sourceRuntimeCwd,
          request.sourceAcpSessionId,
          {
            sourceBusinessSessionId: request.sourceBusinessSessionId,
            preserveSourceSessionBinding: true,
          },
        )
        request.sourceRuntimeHomePath = sourceRuntimeHomePath
        log.info("runtime fork created source session snapshot", {
          businessSessionId: request.businessSessionId,
          sourceBusinessSessionId: request.sourceBusinessSessionId,
          workerId: request.workerId,
          workspaceId: request.workspaceId,
          forkedAcpSessionId: forked.sessionId,
        })
        return openManagedSessionInner(input, request, {
          action: "fork",
          useWarmRuntime: false,
          matchesExisting: (entry) => entry.client.getSessionId() === forked.sessionId,
          coldStart: (entry) => entry.client.loadSession(request.sandboxPath, forked.sessionId),
        })
      })
    }
    request.sourceRuntimeHomePath = resolveForkSourceRuntimeHomePath(request)
    return openManagedSession(input, request, {
      action: "fork",
      useWarmRuntime: false,
      matchesExisting: () => false,
      coldStart: (entry) => entry.client.forkSession(request.sandboxPath, request.sourceAcpSessionId),
    })
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
    const runtimeId = typeof body.remoteRuntimeId === "string" ? body.remoteRuntimeId : ""
    const entry = runtimeId ? findRuntimeById(runtimeId) : undefined
    if (entry) {
      entry.closing = true
      forgetRuntime(entry)
      try {
        if (entry.releaseRuntime) {
          await entry.releaseRuntime()
        } else {
          await entry.client.close()
        }
      } finally {
        await entry.closeSandbox?.()
      }
      return
    }
    const businessSessionId = requireString(body.businessSessionId, "businessSessionId")
    const workspaceId = requireString(body.workspaceId, "workspaceId")
    const workerId = requireString(body.workerId, "workerId")
    await closeOrphanDockerSandbox({ businessSessionId, workspaceId, workerId })
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
    return await withRuntimeOpenTimeout(entry.businessSessionId, open)
  } catch (error) {
    entry.closing = true
    entry.lastFailure = {
      at: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
      detail: {
        source: "runtime_open",
      },
    }
    await disposeFailedOpeningRuntime(entry, error)
    throw error
  }
}

async function openManagedSession(
  runtimeContext: {
    runtimeShellBaseUrl: string
    workerToken: string
  },
  request: SessionRuntimeRequest,
  input: {
    action: "open" | "load" | "resume" | "fork"
    useWarmRuntime?: boolean
    matchesExisting: (entry: RuntimeEntry) => boolean
    warmStart?: (entry: RuntimeEntry, cwd: string) => Promise<Record<string, unknown>>
    coldStart: (entry: RuntimeEntry) => Promise<Record<string, unknown>>
  },
) {
  return runRuntimeBootstrap(request.businessSessionId, () => openManagedSessionInner(runtimeContext, request, input))
}

async function openManagedSessionInner(
  runtimeContext: {
    runtimeShellBaseUrl: string
    workerToken: string
  },
  request: SessionRuntimeRequest,
  input: {
    action: "open" | "load" | "resume" | "fork"
    useWarmRuntime?: boolean
    matchesExisting: (entry: RuntimeEntry) => boolean
    warmStart?: (entry: RuntimeEntry, cwd: string) => Promise<Record<string, unknown>>
    coldStart: (entry: RuntimeEntry) => Promise<Record<string, unknown>>
  },
) {
  const openStartedAt = Date.now()
  const runtimeConfig = buildRuntimeConfigContext(request.configContent)
  const existing = findRuntimeByBusinessSessionId(request.businessSessionId)
  if (existing && input.matchesExisting(existing)) return toBootstrap(existing)
  const warmEntry = input.useWarmRuntime === false
    ? undefined
    : await tryOpenWarmRuntimeEntry({
        runtimeShellBaseUrl: runtimeContext.runtimeShellBaseUrl,
        workerToken: runtimeContext.workerToken,
        ...request,
      })
  if (warmEntry && input.warmStart) {
    log.info("runtime open reusing warm runtime", {
      businessSessionId: request.businessSessionId,
      workerId: request.workerId,
      workspaceId: request.workspaceId,
      configFingerprint: runtimeConfig.configFingerprint,
      openWaitMs: Date.now() - openStartedAt,
    })
    return openAndRememberRuntimeEntry({
      entry: warmEntry,
      request,
      actionLabel: `warm ${input.action} session`,
      start: () => input.warmStart!(warmEntry, warmEntry.sandboxHandle?.runtimeCwd || request.sandboxPath),
    })
  }
  const entry = createRuntimeEntry({
    runtimeShellBaseUrl: runtimeContext.runtimeShellBaseUrl,
    workerToken: runtimeContext.workerToken,
    ...request,
    sourceRuntimeHomePath: readOptionalSourceRuntimeHomePath(request),
    configFingerprint: runtimeConfig.configFingerprint,
  })
  log.info("runtime open falling back to cold runtime", {
    businessSessionId: request.businessSessionId,
    workerId: request.workerId,
    workspaceId: request.workspaceId,
    configFingerprint: runtimeConfig.configFingerprint,
    openWaitMs: Date.now() - openStartedAt,
  })
  return openAndRememberRuntimeEntry({
    entry,
    request,
    actionLabel: input.action === "fork" ? "fork session" : `${input.action} session`,
    start: () => runAcpBootstrapGate(() => input.coldStart(entry)),
  })
}

async function openAndRememberRuntimeEntry(input: {
  entry: RuntimeEntry
  request: SessionRuntimeRequest
  actionLabel: string
  start: () => Promise<Record<string, unknown>>
}) {
  const opening = await rememberOpeningRuntime(
    input.entry,
    () => openRuntimeEntry(input.entry, input.start),
  ).catch((error) => {
    log.warn(`worker ${input.actionLabel} failed`, {
      businessSessionId: input.request.businessSessionId,
      workerId: input.request.workerId,
      workspacePath: input.request.workspacePath,
      sandboxPath: input.request.sandboxPath,
      message: error instanceof Error ? error.message : String(error),
    })
    throw error
  })
  try {
    updateSnapshot(input.entry, opening.response)
    rememberRuntime(input.entry)
    return toBootstrap(input.entry)
  } finally {
    releaseRuntimeClaim(opening.claim)
  }
}

async function rememberOpeningRuntime<T>(entry: ReturnType<typeof createRuntimeEntry>, open: () => Promise<T>) {
  const claim = {
    businessSessionId: entry.businessSessionId,
    workspaceId: entry.workspaceId,
    workerId: entry.workerId,
    containerName: entry.sandboxHandle?.containerName,
  }
  rememberRuntimeClaim(claim)
  try {
    return {
      response: await open(),
      claim,
    }
  } catch (error) {
    releaseRuntimeClaim(claim)
    throw error
  }
}

async function runRuntimeBootstrap<T extends ReturnType<typeof toBootstrap>>(
  businessSessionId: string,
  taskFactory: () => Promise<T>,
) {
  const existing = pendingRuntimeBootstraps.get(businessSessionId)
  if (existing) return existing as Promise<T>
  const task = taskFactory()
  pendingRuntimeBootstraps.set(businessSessionId, task)
  try {
    return await task
  } finally {
    if (pendingRuntimeBootstraps.get(businessSessionId) === task) {
      pendingRuntimeBootstraps.delete(businessSessionId)
    }
  }
}

async function disposeFailedOpeningRuntime(entry: ReturnType<typeof createRuntimeEntry>, error: unknown) {
  if (shouldForceTerminateOpeningRuntime(entry, error)) {
    if (entry.sandboxHandle) {
      // 中文/English: a timed-out or warm-slot bootstrap can no longer be trusted.
      // Mark the slot invalid so release destroys the container/runtime immediately.
      entry.sandboxHandle.invalidPoolSlot = true
    }
    entry.client.terminate(describeOpeningFailure(error))
    await entry.closeSandbox?.().catch(() => {})
    return
  }
  if (entry.releaseRuntime) {
    await entry.releaseRuntime().catch(() => {})
  } else {
    await entry.client.close().catch(() => {})
  }
  await entry.closeSandbox?.().catch(() => {})
}

function shouldForceTerminateOpeningRuntime(entry: ReturnType<typeof createRuntimeEntry>, error: unknown) {
  if (entry.sandboxHandle?.poolSlotId) return true
  return isRuntimeOpenTimeoutError(error)
}

function isRuntimeOpenTimeoutError(error: unknown) {
  return error instanceof Error && error.name === "RuntimeOpenTimeoutError"
}

function describeOpeningFailure(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

async function withRuntimeOpenTimeout<T>(businessSessionId: string, taskFactory: () => Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      taskFactory(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(
            `runtime open timed out after ${RUNTIME_OPEN_TIMEOUT_MS}ms: ${businessSessionId}`,
          )
          error.name = "RuntimeOpenTimeoutError"
          reject(error)
        }, RUNTIME_OPEN_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function readSessionRuntimeRequest(body: Record<string, unknown>): SessionRuntimeRequest {
  const workspacePath = requireString(body.workspacePath, "workspacePath")
  return {
    businessSessionId: requireString(body.businessSessionId, "businessSessionId"),
    workspaceId: requireString(body.workspaceId, "workspaceId"),
    workspacePath,
    sandboxPath: typeof body.sandboxPath === "string" ? body.sandboxPath : workspacePath,
    workerId: requireString(body.workerId, "workerId"),
    configContent: typeof body.configContent === "string" ? body.configContent : undefined,
    warmPoolTarget: typeof body.warmPoolTarget === "number" && Number.isFinite(body.warmPoolTarget)
      ? Math.max(0, Math.floor(body.warmPoolTarget))
      : undefined,
  }
}

function readSessionResumeRequest(body: Record<string, unknown>): SessionResumeRequest {
  return {
    ...readSessionRuntimeRequest(body),
    acpSessionId: requireString(body.acpSessionId, "acpSessionId"),
  }
}

function readSessionForkRequest(body: Record<string, unknown>): SessionForkRequest {
  return {
    ...readSessionRuntimeRequest(body),
    sourceAcpSessionId: requireString(body.sourceAcpSessionId, "sourceAcpSessionId"),
    sourceBusinessSessionId: typeof body.sourceBusinessSessionId === "string" ? body.sourceBusinessSessionId : undefined,
  }
}

function resolveForkSourceRuntimeHomePath(request: SessionForkRequest) {
  const liveSourceRuntime = request.sourceBusinessSessionId
    ? findRuntimeByBusinessSessionId(request.sourceBusinessSessionId)
    : undefined
  if (liveSourceRuntime?.sandboxHandle?.runtimeHomePath) {
    return liveSourceRuntime.sandboxHandle.runtimeHomePath
  }
  // 中文/English: if the source runtime is not live on this worker anymore,
  // reuse the workspace-owned cold runtime home as the persisted fallback.
  return buildColdRuntimeHomePath({
    workerId: request.workerId,
    workspaceId: request.workspaceId,
  })
}

function readOptionalSourceRuntimeHomePath(request: SessionRuntimeRequest) {
  return "sourceRuntimeHomePath" in request && typeof request.sourceRuntimeHomePath === "string"
    ? request.sourceRuntimeHomePath
    : undefined
}
