import path from "node:path"
import type {
  Client,
  CreateElicitationRequest,
  CreateElicitationResponse,
  ReadTextFileRequest,
  ReadTextFileResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from "@agentclientprotocol/sdk"
import type { PendingPermission, PendingQuestion, SessionEvent } from "../types"
import { createLogger } from "../log"
import type { PermissionResolution, RuntimeClientHooks, RuntimeClientOptions } from "./types"

const log = createLogger("acp")

export class RuntimeShellClient implements Client {
  private options: RuntimeClientOptions
  private hooks: RuntimeClientHooks
  private acpSessionId = ""

  constructor(options: RuntimeClientOptions, hooks: RuntimeClientHooks) {
    this.options = options
    this.hooks = hooks
  }

  setSessionId(sessionId: string) {
    this.acpSessionId = sessionId
  }

  async requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const requestId = params.toolCall.toolCallId
    const permission: PendingPermission = {
      requestId,
      businessSessionId: this.options.businessSessionId,
      acpSessionId: this.acpSessionId,
      workerId: this.options.workerId,
      toolName: params.toolCall.title || params.toolCall.toolCallId,
      rawInput: params.toolCall.rawInput,
      options: params.options.map((item) => ({
        optionId: item.optionId,
        kind: item.kind,
        name: item.name,
      })),
      createdAt: new Date().toISOString(),
    }

    // 中文/English: register the pending resolver before exposing the request to
    // the UI so a fast user click cannot resolve "too early" and get lost.
    const resolutionTask = this.hooks.waitForPermission(requestId)
    this.hooks.onPermissionRequested(permission)
    await this.options.onEvent(createLocalEvent(this.options, this.acpSessionId, "permission_requested", {
      requestId,
      toolName: permission.toolName,
      options: params.options,
      rawInput: params.toolCall.rawInput,
    }, permission.createdAt))

    const resolution = await resolutionTask
    await this.options.onEvent(createLocalEvent(this.options, this.acpSessionId, "permission_resolved", {
      requestId,
      outcome: resolution.outcome,
      optionKind: resolution.optionKind,
    }))
    return {
      outcome: resolution.outcome,
    }
  }

  async unstable_createElicitation(params: CreateElicitationRequest): Promise<CreateElicitationResponse> {
    // 中文/English: Runtime-shell 目前只支持表单型提问。
    if (params.mode !== "form") {
      return { action: "decline" }
    }

    // 中文/English: 优先使用上游稳定 ID，避免同一轮交互出现多个本地 requestId。
    const requestId = String(
      ("toolCallId" in params && params.toolCallId ? params.toolCallId : undefined) ||
        ("requestId" in params && params.requestId ? params.requestId : undefined) ||
        `eli_${crypto.randomUUID().replace(/-/g, "")}`,
    )
    const createdAt = new Date().toISOString()
    const question: PendingQuestion = {
      requestId,
      businessSessionId: this.options.businessSessionId,
      acpSessionId: this.acpSessionId,
      workerId: this.options.workerId,
      message: params.message,
      mode: "form",
      requestedSchema: params.requestedSchema as Record<string, unknown>,
      meta: (params._meta ?? undefined) as Record<string, unknown> | undefined,
      createdAt,
    }

    // 中文/English: pre-register the pending question so submit-on-render flows
    // cannot outrun the promise hookup and leave the turn hanging forever.
    const resolutionTask = this.hooks.waitForQuestion(requestId)
    this.hooks.onQuestionRequested(question)
    await this.options.onEvent(createLocalEvent(this.options, this.acpSessionId, "question_requested", {
      requestId,
      message: params.message,
      requestedSchema: params.requestedSchema,
      meta: params._meta ?? null,
    }, createdAt))

    const resolution = await resolutionTask
    await this.options.onEvent(createLocalEvent(this.options, this.acpSessionId, "question_resolved", {
      requestId,
      action: resolution.action,
      ...(resolution.action === "accept" ? { content: resolution.content } : {}),
    }))
    return resolution
  }

  async sessionUpdate(params: SessionNotification) {
    const updateType = mapUpdateType(params.update.sessionUpdate)
    const payload = normalizeUpdatePayload(params.sessionId, params.update as Record<string, unknown>)
    logSessionUpdate(updateType, params.sessionId, payload)
    await this.options.onEvent(createLocalEvent(this.options, params.sessionId, updateType, payload))
  }

  async readTextFile(params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    const content = await Bun.file(resolveWorkspacePath(this.options.cwd, params.path)).text()
    if (!params.line && !params.limit) return { content }
    const start = Math.max((params.line ?? 1) - 1, 0)
    const lines = content.split(/\r?\n/)
    const end = params.limit ? start + params.limit : lines.length
    return { content: lines.slice(start, end).join("\n") }
  }

  async writeTextFile(params: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    await Bun.write(resolveWorkspacePath(this.options.cwd, params.path), params.content)
    return {}
  }
}

function createLocalEvent(
  options: RuntimeClientOptions,
  acpSessionId: string,
  eventType: SessionEvent["eventType"],
  payload: Record<string, unknown>,
  timestamp = new Date().toISOString(),
): SessionEvent {
  return {
    eventId: `evt_${crypto.randomUUID().replace(/-/g, "")}`,
    eventType,
    businessSessionId: options.businessSessionId,
    acpSessionId,
    workerId: options.workerId,
    timestamp,
    payload,
  }
}

function normalizeUpdatePayload(sessionId: string, update: Record<string, unknown>) {
  if (typeof update.sessionId === "string" && update.sessionId) return update
  return {
    ...update,
    // 中文/English: mirror the ACP session id into payload so logs and raw event panels can read one stable field.
    sessionId,
  }
}

function logSessionUpdate(eventType: SessionEvent["eventType"], sessionId: string, update: Record<string, unknown>) {
  if (eventType === "agent_message_chunk" || eventType === "agent_thought_chunk") {
    const preview =
      typeof update.content === "object" && update.content && typeof (update.content as Record<string, unknown>).text === "string"
        ? ((update.content as Record<string, unknown>).text as string).slice(0, 80)
        : ""
    log.info(`event ${eventType}`, { sessionId, preview })
    return
  }
  if (eventType !== "usage_update") {
    log.info(`event ${eventType}`, { sessionId })
  }
}

function resolveWorkspacePath(cwd: string, targetPath: string) {
  const workspaceRoot = path.resolve(cwd)
  const resolved = path.isAbsolute(targetPath) ? path.resolve(targetPath) : path.resolve(workspaceRoot, targetPath)
  const relative = path.relative(workspaceRoot, resolved)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`path is outside workspace: ${targetPath}`)
  }
  return resolved
}

function mapUpdateType(input: string): SessionEvent["eventType"] {
  switch (input) {
    case "agent_message_chunk":
    case "user_message_chunk":
    case "agent_thought_chunk":
    case "tool_call":
    case "tool_call_update":
    case "plan":
    case "usage_update":
    case "available_commands_update":
    case "config_option_update":
    case "current_mode_update":
    case "session_info_update":
      return input
    default:
      return "upstream_update"
  }
}
