import { Readable, Writable } from "node:stream"
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type ContentBlock,
  type CreateElicitationResponse,
  type ElicitationContentValue,
  type ForkSessionResponse,
  type InitializeResponse,
  type LoadSessionResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
  type SetSessionConfigOptionRequest,
  type SetSessionConfigOptionResponse,
  type SetSessionModeRequest,
  type SetSessionModeResponse,
  type SetSessionModelRequest,
  type SetSessionModelResponse,
} from "@agentclientprotocol/sdk"
import type { PendingPermission, PendingQuestion } from "../types"
import { createLogger } from "../log"
import { spawnAcpProcess, logAcpStderr } from "./process-spawn"
import { RuntimeShellClient } from "./runtime-shell-client"
import type { PendingResolver, PermissionResolution, RuntimeClientOptions } from "./types"

const log = createLogger("acp")

export class AcpProcessClient {
  private proc
  private client: RuntimeShellClient
  private connection
  private initialized?: InitializeResponse
  private sessionId = ""
  private waitForPendingEvents: () => Promise<void>
  private onPermissionRequestedHandler?: (permission: PendingPermission) => void
  private pendingPermissions = new Map<string, PendingResolver<PermissionResolution>>()
  private onQuestionRequestedHandler?: (question: PendingQuestion) => void
  private pendingQuestions = new Map<string, PendingResolver<CreateElicitationResponse>>()

  constructor(options: RuntimeClientOptions, waitForPendingEvents: () => Promise<void> = () => Promise.resolve()) {
    this.proc = spawnAcpProcess(options)
    logAcpStderr(this.proc)
    this.waitForPendingEvents = waitForPendingEvents

    const output = Writable.toWeb(this.proc.stdin)
    const input = Readable.toWeb(this.proc.stdout) as unknown as ReadableStream<Uint8Array>
    const stream = ndJsonStream(output, input)

    this.client = new RuntimeShellClient(options, {
      onPermissionRequested: (permission) => {
        this.onPermissionRequestedHandler?.(permission)
      },
      waitForPermission: async (requestId) =>
        new Promise<PermissionResolution>((resolve, reject) => {
          this.pendingPermissions.set(requestId, { resolve, reject })
        }),
      onQuestionRequested: (question) => {
        this.onQuestionRequestedHandler?.(question)
      },
      waitForQuestion: async (requestId) =>
        new Promise<CreateElicitationResponse>((resolve, reject) => {
          this.pendingQuestions.set(requestId, { resolve, reject })
        }),
    })
    this.connection = new ClientSideConnection(() => this.client, stream)

    this.proc.once("exit", () => {
      rejectPending(this.pendingPermissions, "ACP runtime exited")
      rejectPending(this.pendingQuestions, "ACP runtime exited")
    })
  }

  onPermissionRequested(handler: (permission: PendingPermission) => void) {
    this.onPermissionRequestedHandler = handler
  }

  onQuestionRequested(handler: (question: PendingQuestion) => void) {
    this.onQuestionRequestedHandler = handler
  }

  async initialize() {
    if (this.initialized) return this.initialized
    log.info("sending initialize", { protocolVersion: PROTOCOL_VERSION })
    this.initialized = await this.connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        // 中文/English: explicitly declare elicitation support so QuestionTool
        // callbacks are routed back to the current runtime-shell client.
        elicitation: {
          form: {},
        },
        fs: {
          readTextFile: true,
          writeTextFile: true,
        },
      },
    })
    log.info("initialize succeeded", {
      agent: this.initialized.agentInfo?.name,
      version: this.initialized.agentInfo?.version,
    })
    return this.initialized
  }

  async newSession(cwd: string): Promise<NewSessionResponse> {
    return this.createSession({ cwd, mcpServers: [] })
  }

  async createSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    await this.initialize()
    log.info("sending newSession")
    const result = await this.connection.newSession(params)
    this.bindSession(result.sessionId)
    log.info("newSession succeeded", { acpSessionId: result.sessionId })
    return result
  }

  async loadSession(cwd: string, sessionId: string): Promise<LoadSessionResponse> {
    await this.initialize()
    const result = await this.connection.loadSession({ cwd, sessionId, mcpServers: [] })
    this.bindSession(sessionId)
    return result
  }

  async resumeSession(cwd: string, sessionId: string) {
    await this.initialize()
    const result = await this.connection.resumeSession({ cwd, sessionId, mcpServers: [] })
    this.bindSession(sessionId)
    return result
  }

  async forkSession(cwd: string, sessionId: string): Promise<ForkSessionResponse> {
    await this.initialize()
    const result = await this.connection.unstable_forkSession({ cwd, sessionId, mcpServers: [] })
    this.bindSession(result.sessionId)
    return result
  }

  async listSessions(cwd: string) {
    await this.initialize()
    return this.connection.listSessions({ cwd })
  }

  async prompt(parts: ContentBlock[]): Promise<PromptResponse> {
    log.info("sending prompt", { sessionId: this.sessionId, partCount: parts.length })
    const result = await this.connection.prompt({
      sessionId: this.sessionId,
      prompt: parts,
    } satisfies PromptRequest)
    ////////////// runtime-shell customization start //////////////
    // 中文/English: this log only means ACP `prompt()` returned.
    // The real frontend-visible turn end still depends on later `turn_completed` publishing.
    log.info("prompt returned", { sessionId: this.sessionId, stopReason: result.stopReason })
    ////////////// runtime-shell customization end //////////////
    return result
  }

  async flushPendingEvents() {
    await this.waitForPendingEvents()
  }

  async cancel() {
    if (!this.sessionId) return
    // 中文/English: only cancel the current turn input, not the whole ACP session.
    await this.connection.cancel({ sessionId: this.sessionId })
  }

  async setSessionMode(modeId: string): Promise<SetSessionModeResponse> {
    return this.connection.setSessionMode({
      sessionId: this.sessionId,
      modeId,
    } satisfies SetSessionModeRequest)
  }

  async setSessionModel(modelId: string): Promise<SetSessionModelResponse> {
    return this.connection.unstable_setSessionModel({
      sessionId: this.sessionId,
      modelId,
    } satisfies SetSessionModelRequest)
  }

  async setSessionConfigOption(configId: string, value: string | boolean): Promise<SetSessionConfigOptionResponse> {
    return this.connection.setSessionConfigOption(
      typeof value === "boolean"
        ? ({
            sessionId: this.sessionId,
            configId,
            type: "boolean",
            value,
          } satisfies SetSessionConfigOptionRequest)
        : ({
            sessionId: this.sessionId,
            configId,
            value,
          } satisfies SetSessionConfigOptionRequest),
    )
  }

  resolvePermission(requestId: string, optionId: string) {
    const pending = this.pendingPermissions.get(requestId)
    if (!pending) return false
    this.pendingPermissions.delete(requestId)
    pending.resolve({
      outcome: {
        outcome: "selected",
        optionId,
      },
      optionKind: optionId,
    })
    return true
  }

  rejectPermission(requestId: string) {
    const pending = this.pendingPermissions.get(requestId)
    if (!pending) return false
    this.pendingPermissions.delete(requestId)
    pending.resolve({
      outcome: {
        outcome: "cancelled",
      },
      optionKind: "reject",
    })
    return true
  }

  // 中文/English: finish one pending question with the user's structured input.
  resolveQuestion(requestId: string, response: CreateElicitationResponse) {
    const pending = this.pendingQuestions.get(requestId)
    if (!pending) return false
    this.pendingQuestions.delete(requestId)
    pending.resolve(response)
    return true
  }

  async close() {
    log.info("closing ACP process", { sessionId: this.sessionId })
    if (this.sessionId) {
      await this.closeSession(this.sessionId)
    }
    rejectPending(this.pendingPermissions, "ACP runtime closed")
    rejectPending(this.pendingQuestions, "ACP runtime closed")
    this.proc.kill()
    log.info("ACP process killed")
  }

  async closeSession(sessionId: string) {
    await this.connection.closeSession({ sessionId })
  }

  getSessionId() {
    return this.sessionId
  }

  onExit(handler: (code: number | null, signal: NodeJS.Signals | null) => void) {
    this.proc.once("exit", (code, signal) => {
      log.info("ACP process exited", { code, signal })
      handler(code, signal)
    })
  }

  private bindSession(sessionId: string) {
    this.sessionId = sessionId
    this.client.setSessionId(sessionId)
  }
}

function rejectPending<T>(pendingMap: Map<string, PendingResolver<T>>, message: string) {
  pendingMap.forEach((pending) => pending.reject(new Error(message)))
  pendingMap.clear()
}
