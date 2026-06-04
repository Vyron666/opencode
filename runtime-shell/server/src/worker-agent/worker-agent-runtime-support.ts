import type {
  ForkSessionResponse,
  LoadSessionResponse,
  NewSessionResponse,
  ResumeSessionResponse,
} from "@agentclientprotocol/sdk"
import { AcpProcessClient } from "../acp/acp-process-client"
import { Config } from "../config"
import { createUpstreamDrainController } from "../runtime/upstream-drain"
import type { SessionEvent } from "../types"
import { recordPromptEventTrace } from "./worker-agent-prompt-observe"
import { createSandboxManager } from "./sandbox/sandbox-manager"
import type { SandboxHandle } from "./sandbox/sandbox-types"
import { forgetRuntime } from "./worker-agent-store"
import type { RuntimeEntry, RuntimeSnapshot } from "./worker-agent-types"

export function createRuntimeEntry(input: {
  runtimeShellBaseUrl: string
  workerToken: string
  businessSessionId: string
  workspaceId: string
  workspacePath: string
  sandboxPath?: string
  workerId: string
  configContent?: string
  configFingerprint?: string
}) {
  const remoteRuntimeId = `rrt_${crypto.randomUUID().replace(/-/g, "")}`
  const sandboxManager = createSandboxManager(Config.sandboxBackend)
  const sandboxHandle = sandboxManager.prepare({
    businessSessionId: input.businessSessionId,
    workspaceId: input.workspaceId,
    workerId: input.workerId,
    workspacePath: input.workspacePath,
    sandboxPath: input.sandboxPath,
    configFingerprint: input.configFingerprint,
  })
  const runtimeCwd = sandboxHandle.runtimeCwd || input.sandboxPath || input.workspacePath
  const client = new AcpProcessClient(
    {
      // 中文/English: ACP must run inside the sandbox copy when present,
      // otherwise sandbox mount validation and write isolation both break.
      cwd: runtimeCwd,
      businessSessionId: input.businessSessionId,
      workerId: input.workerId,
      configContent: input.configContent,
      onEvent: async () => {
        // 中文/English: runtime entry context is bound immediately after construction.
      },
    },
    () => Promise.resolve(),
    (options) =>
      sandboxManager.attachAcp({
        handle: sandboxHandle,
        runtimeClientOptions: options,
      }),
  )
  const entry = createRuntimeEntryFromClient({
    remoteRuntimeId,
    runtimeShellBaseUrl: input.runtimeShellBaseUrl,
    workerToken: input.workerToken,
    businessSessionId: input.businessSessionId,
    workspaceId: input.workspaceId,
    workspacePath: input.workspacePath,
    sandboxPath: input.sandboxPath,
    workerId: input.workerId,
    client,
    sandboxHandle,
    closeSandbox: () => sandboxManager.close({ handle: sandboxHandle }),
  })
  bindRuntimeEntryClientContext(entry, {
    runtimeShellBaseUrl: input.runtimeShellBaseUrl,
    workerToken: input.workerToken,
    cwd: runtimeCwd,
    configContent: input.configContent,
  })
  return entry
}

export function createRuntimeEntryFromClient(input: {
  remoteRuntimeId?: string
  runtimeShellBaseUrl: string
  workerToken: string
  businessSessionId: string
  workspaceId: string
  workspacePath: string
  sandboxPath?: string
  workerId: string
  client: AcpProcessClient
  sandboxHandle?: SandboxHandle
  closeSandbox?: () => Promise<void>
  releaseRuntime?: () => Promise<void>
}): RuntimeEntry {
  const entry: RuntimeEntry = {
    remoteRuntimeId: input.remoteRuntimeId || `rrt_${crypto.randomUUID().replace(/-/g, "")}`,
    businessSessionId: input.businessSessionId,
    workspaceId: input.workspaceId,
    workerId: input.workerId,
    workspacePath: input.workspacePath,
    sandboxPath: input.sandboxPath,
    sandboxHandle: input.sandboxHandle,
    closeSandbox: input.closeSandbox,
    releaseRuntime: input.releaseRuntime,
    client: input.client,
    snapshot: {},
    closing: false,
    openedAt: new Date().toISOString(),
    pendingPermissions: new Map(),
    pendingQuestions: new Map(),
  }
  input.client.onPermissionRequested((permission) => {
    entry.pendingPermissions.set(permission.requestId, permission)
  })
  input.client.onQuestionRequested((question) => {
    entry.pendingQuestions.set(question.requestId, question)
  })
  entry.disposeClientExitHandler = input.client.onExit((code, signal) => {
    forgetRuntime(entry)
    void entry.closeSandbox?.()
    if (entry.closing) return
    entry.lastFailure = {
      at: new Date().toISOString(),
      message: "ACP runtime exited unexpectedly",
      detail: { code, signal, source: "process_exit" },
    }
    void pushEvent({
      runtimeShellBaseUrl: input.runtimeShellBaseUrl,
      workerToken: input.workerToken,
      entry,
      event: {
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
      },
    })
  })
  return entry
}

export function bindRuntimeEntryClientContext(input: RuntimeEntry, context: {
  runtimeShellBaseUrl: string
  workerToken: string
  cwd: string
  configContent?: string
}) {
  const upstreamDrain = createUpstreamDrainController()
  input.client.setContext({
    cwd: context.cwd,
    businessSessionId: input.businessSessionId,
    workerId: input.workerId,
    configContent: context.configContent,
    onEvent: async (event) => {
      const nextPush = pushEvent({
        runtimeShellBaseUrl: context.runtimeShellBaseUrl,
        workerToken: context.workerToken,
        entry: input,
        event,
      })
      upstreamDrain.track(nextPush)
      await nextPush
    },
  })
  input.client.setWaitForPendingEvents(() => upstreamDrain.waitForQuiet())
}

export function toBootstrap(entry: RuntimeEntry) {
  return {
    remoteRuntimeId: entry.remoteRuntimeId,
    remoteSessionId: entry.client.getSessionId(),
    configOptions: entry.snapshot.configOptions ?? [],
    models: entry.snapshot.models,
    modes: entry.snapshot.modes,
  }
}

export function updateSnapshot(
  entry: RuntimeEntry,
  response: NewSessionResponse | LoadSessionResponse | ResumeSessionResponse | ForkSessionResponse | Record<string, unknown>,
) {
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

export function isPromptInterrupted(error: unknown) {
  if (!(error instanceof Error)) return false
  return error.name === "MessageAbortedError" || /aborted|cancelled|canceled|runtime (closed|exited)/i.test(error.message)
}

async function pushEvent(input: {
  runtimeShellBaseUrl: string
  workerToken: string
  entry: RuntimeEntry
  event: SessionEvent
}) {
  input.entry.lastEventAt = input.event.timestamp
  recordPromptEventTrace(input.entry, input.event)
  const requestId = typeof input.event.payload.requestId === "string" ? input.event.payload.requestId : undefined
  const payload = {
    event: input.event,
    pendingPermission:
      input.event.eventType === "permission_requested" && requestId
        ? input.entry.pendingPermissions.get(requestId)
        : undefined,
    pendingQuestion:
      input.event.eventType === "question_requested" && requestId
        ? input.entry.pendingQuestions.get(requestId)
        : undefined,
  }
  const response = await fetch(`${input.runtimeShellBaseUrl}/api/internal/runtime/event-push`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-runtime-worker-token": input.workerToken,
    },
    body: JSON.stringify(payload),
  })
  if (response.ok) return
  const responseText = await response.text()
  input.entry.lastFailure = {
    at: new Date().toISOString(),
    message: `failed to push runtime event: ${response.status}`,
    detail: { response: responseText, source: "event_push" },
  }
  throw new Error(`failed to push runtime event: ${response.status} ${responseText}`)
}
