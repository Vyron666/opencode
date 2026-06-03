import type {
  ContentBlock,
  CreateElicitationResponse,
  ForkSessionResponse,
  LoadSessionResponse,
  NewSessionResponse,
  PromptResponse,
  ResumeSessionResponse,
  SetSessionConfigOptionResponse,
  SetSessionModeResponse,
  SetSessionModelResponse,
} from "@agentclientprotocol/sdk"
import { Config, type LocalWorkerConfig } from "../config"
import { createLogger } from "../log"
import { getSandboxWorkspace } from "../services/sandbox/sandbox-workspace-service"
import type { BusinessSession, PendingPermission, PendingQuestion } from "../types"
import type { ManagedRuntimeClient } from "./runtime-client"

const log = createLogger("remote-runtime-client")

type RemoteRuntimeBootstrap = {
  remoteRuntimeId: string
  remoteSessionId: string
  configOptions?: NewSessionResponse["configOptions"]
  models?: NewSessionResponse["models"] | LoadSessionResponse["models"] | ResumeSessionResponse["models"] | ForkSessionResponse["models"]
  modes?: NewSessionResponse["modes"] | LoadSessionResponse["modes"] | ResumeSessionResponse["modes"] | ForkSessionResponse["modes"]
}

export class RemoteRuntimeClient implements ManagedRuntimeClient {
  private worker: LocalWorkerConfig
  private session: BusinessSession
  private configContent?: string
  private remoteRuntimeId = ""
  private remoteSessionId = ""
  private activePromptCount = 0

  constructor(session: BusinessSession, worker: LocalWorkerConfig, configContent?: string) {
    this.session = session
    this.worker = worker
    this.configContent = configContent
  }

  onPermissionRequested(_handler: (permission: PendingPermission) => void) {}

  onQuestionRequested(_handler: (question: PendingQuestion) => void) {}

  async newSession(cwd: string): Promise<NewSessionResponse> {
    const sandboxWorkspace = await getSandboxWorkspace(this.session.workspaceId)
    const response = await this.post<RemoteRuntimeBootstrap>("/runtime/open-session", {
      businessSessionId: this.session.id,
      workspaceId: this.session.workspaceId,
      workerId: this.session.workerId,
      workspacePath: cwd,
      sandboxPath: sandboxWorkspace?.sandboxPath || cwd,
      configContent: this.configContent,
    })
    this.bindRemote(response)
    return {
      sessionId: response.remoteSessionId,
      configOptions: response.configOptions ?? [],
      models: response.models,
      modes: response.modes,
    }
  }

  async loadSession(cwd: string, sessionId: string): Promise<LoadSessionResponse> {
    const sandboxWorkspace = await getSandboxWorkspace(this.session.workspaceId)
    const response = await this.post<RemoteRuntimeBootstrap>("/runtime/load-session", {
      businessSessionId: this.session.id,
      workspaceId: this.session.workspaceId,
      workerId: this.session.workerId,
      workspacePath: cwd,
      sandboxPath: sandboxWorkspace?.sandboxPath || cwd,
      acpSessionId: sessionId,
      configContent: this.configContent,
    })
    this.bindRemote(response)
    return {
      configOptions: response.configOptions ?? [],
      models: response.models,
      modes: response.modes,
    }
  }

  async resumeSession(cwd: string, sessionId: string): Promise<ResumeSessionResponse> {
    const sandboxWorkspace = await getSandboxWorkspace(this.session.workspaceId)
    const response = await this.post<RemoteRuntimeBootstrap>("/runtime/resume-session", {
      businessSessionId: this.session.id,
      workspaceId: this.session.workspaceId,
      workerId: this.session.workerId,
      workspacePath: cwd,
      sandboxPath: sandboxWorkspace?.sandboxPath || cwd,
      acpSessionId: sessionId,
      configContent: this.configContent,
    })
    this.bindRemote(response)
    return {
      configOptions: response.configOptions ?? [],
      models: response.models,
      modes: response.modes,
    }
  }

  async forkSession(cwd: string, sessionId: string): Promise<ForkSessionResponse> {
    const sandboxWorkspace = await getSandboxWorkspace(this.session.workspaceId)
    const response = await this.post<RemoteRuntimeBootstrap>("/runtime/fork-session", {
      businessSessionId: this.session.id,
      workspaceId: this.session.workspaceId,
      workerId: this.session.workerId,
      workspacePath: cwd,
      sandboxPath: sandboxWorkspace?.sandboxPath || cwd,
      sourceAcpSessionId: sessionId,
      configContent: this.configContent,
    })
    this.bindRemote(response)
    return {
      sessionId: response.remoteSessionId,
      configOptions: response.configOptions ?? [],
      models: response.models,
      modes: response.modes,
    }
  }

  async prompt(parts: ContentBlock[]): Promise<PromptResponse> {
    this.activePromptCount += 1
    try {
      return await this.post<PromptResponse>("/runtime/send-prompt", {
        remoteRuntimeId: this.requireRemoteRuntimeId(),
        parts,
      })
    } finally {
      this.activePromptCount = Math.max(0, this.activePromptCount - 1)
    }
  }

  async flushPendingEvents() {}

  async cancel() {
    await this.post("/runtime/cancel-prompt", {
      remoteRuntimeId: this.requireRemoteRuntimeId(),
    })
  }

  hasActivePrompt() {
    return this.activePromptCount > 0
  }

  async setSessionMode(modeId: string): Promise<SetSessionModeResponse> {
    return this.post<SetSessionModeResponse>("/runtime/set-mode", {
      remoteRuntimeId: this.requireRemoteRuntimeId(),
      modeId,
    })
  }

  async setSessionModel(modelId: string): Promise<SetSessionModelResponse> {
    return this.post<SetSessionModelResponse>("/runtime/set-model", {
      remoteRuntimeId: this.requireRemoteRuntimeId(),
      modelId,
    })
  }

  async setSessionConfigOption(configId: string, value: string | boolean): Promise<SetSessionConfigOptionResponse> {
    return this.post<SetSessionConfigOptionResponse>("/runtime/set-config", {
      remoteRuntimeId: this.requireRemoteRuntimeId(),
      configId,
      value,
    })
  }

  resolvePermission() {
    return false
  }

  rejectPermission() {
    return false
  }

  resolveQuestion(_requestId: string, _response: CreateElicitationResponse) {
    return false
  }

  async close() {
    await this.post("/runtime/close-session", {
      remoteRuntimeId: this.requireRemoteRuntimeId(),
      businessSessionId: this.session.id,
      workspaceId: this.session.workspaceId,
      workerId: this.session.workerId,
    })
  }

  async closeSession(sessionId: string) {
    await this.post("/runtime/close-session", {
      remoteRuntimeId: this.requireRemoteRuntimeId(),
      acpSessionId: sessionId,
      businessSessionId: this.session.id,
      workspaceId: this.session.workspaceId,
      workerId: this.session.workerId,
    })
  }

  getSessionId() {
    return this.remoteSessionId || this.session.binding?.acpSessionId || ""
  }

  getRuntimeId() {
    return this.remoteRuntimeId || this.session.binding?.runtimeKey || ""
  }

  onExit(_handler: (code: number | null, signal: NodeJS.Signals | null) => void) {}

  private bindRemote(response: RemoteRuntimeBootstrap) {
    this.remoteRuntimeId = response.remoteRuntimeId
    this.remoteSessionId = response.remoteSessionId
  }

  private requireRemoteRuntimeId() {
    const remoteRuntimeId = this.remoteRuntimeId || this.session.binding?.runtimeKey
    if (!remoteRuntimeId) {
      throw new Error(`remote runtime is not bound: ${this.session.id}`)
    }
    return remoteRuntimeId
  }

  private async post<T = { success: true }>(pathname: string, body: Record<string, unknown>) {
    return postRemoteWorker<T>(this.worker, pathname, body)
  }
}

export async function closeRemoteRuntimeBinding(session: BusinessSession) {
  if (Config.workerExecutionMode !== "remote" || !session.workerId) return false
  const worker = Config.localWorkers.find((item) => item.id === session.workerId)
  if (!worker) return false
  const remoteRuntimeId = session.binding?.runtimeKey
  if (!remoteRuntimeId) return false
  await postRemoteWorker(worker, "/runtime/close-session", {
    remoteRuntimeId,
    businessSessionId: session.id,
    workspaceId: session.workspaceId,
    workerId: session.workerId,
  })
  return true
}

async function postRemoteWorker<T = { success: true }>(
  worker: LocalWorkerConfig,
  pathname: string,
  body: Record<string, unknown>,
) {
  const agentBaseUrl = worker.agentBaseUrl || worker.baseUrl.replace(/:\d+$/, ":4097")
  const response = await fetch(`${agentBaseUrl}${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-runtime-worker-token": Config.workerAgentToken,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const message = await response.text()
    log.warn("remote worker request failed", {
      workerId: worker.id,
      pathname,
      status: response.status,
      message,
    })
    throw new Error(message || `remote worker request failed: ${response.status}`)
  }
  return response.json() as Promise<T>
}
