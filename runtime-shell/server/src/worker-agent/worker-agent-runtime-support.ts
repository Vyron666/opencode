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
import { forgetRuntime } from "./worker-agent-store"
import type { RuntimeEntry, RuntimeSnapshot } from "./worker-agent-types"

export function createRuntimeEntry(input: {
  runtimeShellBaseUrl: string
  workerToken: string
  businessSessionId: string
  workspacePath: string
  sandboxPath?: string
  workerId: string
  configContent?: string
}) {
  const remoteRuntimeId = `rrt_${crypto.randomUUID().replace(/-/g, "")}`
  const upstreamDrain = createUpstreamDrainController()
  const sandboxManager = createSandboxManager(Config.sandboxBackend)
  const sandboxHandle = sandboxManager.prepare({
    businessSessionId: input.businessSessionId,
    workerId: input.workerId,
    workspacePath: input.workspacePath,
    sandboxPath: input.sandboxPath,
  })
  const runtimeCwd = sandboxHandle.runtimeCwd || input.sandboxPath || input.workspacePath
  const entry: RuntimeEntry = {
    remoteRuntimeId,
    businessSessionId: input.businessSessionId,
    workerId: input.workerId,
    workspacePath: input.workspacePath,
    sandboxPath: input.sandboxPath,
    sandboxHandle,
    closeSandbox: () => sandboxManager.close({ handle: sandboxHandle }),
    client: new AcpProcessClient(
      {
        // 中文/English: ACP must run inside the sandbox copy when present,
        // otherwise sandbox mount validation and write isolation both break.
        cwd: runtimeCwd,
        businessSessionId: input.businessSessionId,
        workerId: input.workerId,
        configContent: input.configContent,
        onEvent: async (event) => {
          const nextPush = pushEvent({
            runtimeShellBaseUrl: input.runtimeShellBaseUrl,
            workerToken: input.workerToken,
            entry,
            event,
          })
          upstreamDrain.track(nextPush)
          await nextPush
        },
      },
      () => {
        // 中文/English: mirror the local runtime drain semantics so remote worker
        // prompts also wait for persisted tail events before reporting completion.
        return upstreamDrain.waitForQuiet()
      },
      (options) => {
        // 中文/English: keep ACP transport unchanged while the selected sandbox
        // backend owns process creation and lifecycle isolation.
        return sandboxManager.attachAcp({
          handle: sandboxHandle,
          runtimeClientOptions: options,
        })
      },
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
