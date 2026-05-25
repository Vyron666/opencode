import { stat } from "node:fs/promises"
import type { Context } from "hono"
import type { Annotations, ContentBlock, Role } from "@agentclientprotocol/sdk"
import { store } from "../store"
import { jsonError, requestId } from "./response"
import type { BusinessSession, SessionEvent, User, Workspace, WorkspaceAccessResult } from "../types"
import { listPendingPermissions, listPendingQuestions, openRealRuntime } from "../acp-runtime-manager"
import type { inputPartSchema, annotationsSchema } from "./schemas"
import type { z } from "zod"

export function sessionSummary(session: BusinessSession) {
  return {
    ...session,
    eventCount: store.listEvents(session.id).length,
    pendingPermissions: listPendingPermissions(session.id),
    pendingQuestions: listPendingQuestions(session.id),
  }
}

export function createSessionEvent(
  session: BusinessSession,
  eventType: SessionEvent["eventType"],
  payload: Record<string, unknown>,
): SessionEvent {
  const currentSession = store.getSession(session.id) || session
  return {
    eventId: `evt_${crypto.randomUUID().replace(/-/g, "")}`,
    eventType,
    businessSessionId: currentSession.id,
    // 中文/English: always read the live binding from store so events emitted after open/load
    // carry the real ACP session id instead of the stale pre-bind session snapshot.
    acpSessionId: currentSession.binding?.acpSessionId,
    workerId: currentSession.workerId,
    timestamp: new Date().toISOString(),
    payload,
  }
}

export function requireBusinessSession(c: Context, sessionId: string, user?: User) {
  const session = store.getSession(sessionId)
  if (!session) {
    const reqId = requestId(c)
    return {
      response: c.json(jsonError("session not found", 404, reqId), 404),
    }
  }
  if (user && (session.tenantId !== user.tenantId || session.organizationId !== user.organizationId)) {
    const reqId = requestId(c)
    return {
      response: c.json(jsonError("forbidden", 403, reqId), 403),
    }
  }
  return { session }
}

export function normalizeAnnotations(annotations?: z.infer<typeof annotationsSchema>): Annotations | undefined {
  if (!annotations) return undefined
  return {
    ...annotations,
    ...(annotations.audience ? { audience: annotations.audience as Role[] } : {}),
  }
}

export function toContentBlock(part: z.infer<typeof inputPartSchema>): ContentBlock {
  if (part.type === "text") {
    return {
      type: "text",
      text: part.text,
      ...(part.annotations ? { annotations: normalizeAnnotations(part.annotations) } : {}),
    }
  }
  if (part.type === "image") {
    return {
      type: "image",
      data: part.data,
      mimeType: part.mimeType,
      ...(part.uri ? { uri: part.uri } : {}),
      ...(part.annotations ? { annotations: normalizeAnnotations(part.annotations) } : {}),
    }
  }
  if (part.type === "audio") {
    return {
      type: "audio",
      data: part.data,
      mimeType: part.mimeType,
      ...(part.annotations ? { annotations: normalizeAnnotations(part.annotations) } : {}),
    }
  }
  if (part.type === "resource_link") {
    return {
      type: "resource_link",
      uri: part.uri,
      name: part.name,
      ...(part.title ? { title: part.title } : {}),
      ...(part.description ? { description: part.description } : {}),
      ...(part.mimeType ? { mimeType: part.mimeType } : {}),
      ...(part.size !== undefined ? { size: part.size } : {}),
      ...(part.annotations ? { annotations: normalizeAnnotations(part.annotations) } : {}),
    }
  }
  return {
    type: "resource",
    resource: "text" in part.resource
      ? {
          uri: part.resource.uri,
          text: part.resource.text,
          ...(part.resource.mimeType ? { mimeType: part.resource.mimeType } : {}),
        }
      : {
          uri: part.resource.uri,
          blob: part.resource.blob,
          ...(part.resource.mimeType ? { mimeType: part.resource.mimeType } : {}),
        },
    ...(part.annotations ? { annotations: normalizeAnnotations(part.annotations) } : {}),
  }
}

function containsCjkText(parts: z.infer<typeof inputPartSchema>[]) {
  return parts.some((part) => {
    if (part.type === "text") return /[\u3400-\u9fff\uf900-\ufaff]/u.test(part.text)
    if (part.type === "resource" && "text" in part.resource) return /[\u3400-\u9fff\uf900-\ufaff]/u.test(part.resource.text)
    return false
  })
}

export function withLocaleGuidance(parts: z.infer<typeof inputPartSchema>[]) {
  if (!containsCjkText(parts)) return parts.map(toContentBlock)
  return [
    {
      type: "text",
      text: "请使用中文思考并使用中文回复用户；如无必要，不要切换到英文。",
      annotations: {
        audience: ["assistant"],
      },
    } satisfies ContentBlock,
    ...parts.map(toContentBlock),
  ]
}

export async function requireWorkspacePath(workspacePath: string) {
  const info = await stat(workspacePath)
  if (!info.isDirectory()) throw new Error(`workspace path is not a directory: ${workspacePath}`)
}

export async function ensureWorkspaceForUser(input: {
  user: User
  projectId: string
  workspaceId: string
}): Promise<WorkspaceAccessResult> {
  const workspace = store.getWorkspace(input.workspaceId)
  if (!workspace) return { ok: false, reason: "workspace_not_found" }
  if (workspace.tenantId !== input.user.tenantId || workspace.organizationId !== input.user.organizationId) {
    return { ok: false, reason: "forbidden" }
  }
  if (workspace.projectId !== input.projectId) {
    return { ok: false, reason: "forbidden" }
  }
  const info = await stat(workspace.rootPath).catch(() => null)
  if (!info?.isDirectory()) return { ok: false, reason: "invalid_path" }
  return { ok: true, workspace }
}

export async function openSessionWithFallback(session: BusinessSession, workspace?: Workspace) {
  await requireWorkspacePath(workspace?.rootPath || session.workspacePath)
  // 中文/English: runtime-shell only supports a real ACP runtime; failures bubble up to the HTTP layer.
  const opened = await openRealRuntime(session)
  return store.getSession(session.id) || store.getSession(opened.client.getSessionId())
}
