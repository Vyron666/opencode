import type { ElicitationContentValue } from "@agentclientprotocol/sdk"
import type { PendingPermission, PendingQuestion, SessionEvent } from "../types"
import type { PermissionResponder, QuestionResponder, RuntimeEntry } from "./runtime-types"

const runtimes = new Map<string, RuntimeEntry>()
const subscribers = new Map<string, Set<(event: SessionEvent) => void>>()
const closingSessions = new Set<string>()
const pendingPermissions = new Map<string, PendingPermission>()
const pendingPermissionResponders = new Map<string, PermissionResponder>()
const pendingQuestions = new Map<string, PendingQuestion>()
const pendingQuestionResponders = new Map<string, QuestionResponder>()

export function getRuntime(sessionId: string) {
  return runtimes.get(sessionId)
}

export function setRuntime(sessionId: string, runtime: RuntimeEntry) {
  runtimes.set(sessionId, runtime)
}

export function deleteRuntime(sessionId: string) {
  runtimes.delete(sessionId)
}

export function subscribeRuntimeEvents(sessionId: string, handler: (event: SessionEvent) => void) {
  const set = subscribers.get(sessionId) ?? new Set<(event: SessionEvent) => void>()
  set.add(handler)
  subscribers.set(sessionId, set)
  return () => {
    const current = subscribers.get(sessionId)
    if (!current) return
    current.delete(handler)
    if (!current.size) subscribers.delete(sessionId)
  }
}

export function publishToSubscribers(event: SessionEvent) {
  subscribers.get(event.businessSessionId)?.forEach((handler) => handler(event))
}

export function markClosingSession(sessionId: string) {
  closingSessions.add(sessionId)
}

export function consumeClosingSession(sessionId: string) {
  if (!closingSessions.has(sessionId)) return false
  closingSessions.delete(sessionId)
  return true
}

export function listPendingPermissions(sessionId?: string) {
  return [...pendingPermissions.values()].filter((item) => !sessionId || item.businessSessionId === sessionId)
}

export function addPendingPermission(permission: PendingPermission, responder: PermissionResponder) {
  pendingPermissions.set(permission.requestId, permission)
  pendingPermissionResponders.set(permission.requestId, responder)
}

export function resolvePendingPermission(requestId: string, input: { approved: boolean; optionId?: string }) {
  const responder = pendingPermissionResponders.get(requestId)
  if (!responder) return false
  responder.resolve(input)
  return true
}

export function clearPendingPermissionsBySession(sessionId: string) {
  pendingPermissions.forEach((permission, requestId) => {
    if (permission.businessSessionId !== sessionId) return
    pendingPermissions.delete(requestId)
    pendingPermissionResponders.delete(requestId)
  })
}

export function deletePendingPermission(requestId: string) {
  pendingPermissions.delete(requestId)
  pendingPermissionResponders.delete(requestId)
}

export function listPendingQuestions(sessionId?: string) {
  return [...pendingQuestions.values()].filter((item) => !sessionId || item.businessSessionId === sessionId)
}

export function addPendingQuestion(question: PendingQuestion, responder: QuestionResponder) {
  pendingQuestions.set(question.requestId, question)
  pendingQuestionResponders.set(question.requestId, responder)
}

export function resolvePendingQuestion(
  requestId: string,
  input: { action: "accept" | "decline" | "cancel"; content?: Record<string, unknown> },
  mapContent: (input?: Record<string, unknown>) => Record<string, ElicitationContentValue>,
) {
  const responder = pendingQuestionResponders.get(requestId)
  if (!responder) return false
  responder.resolve({
    action: input.action,
    ...(input.action === "accept" ? { content: mapContent(input.content) } : {}),
  })
  return true
}

export function clearPendingQuestionsBySession(sessionId: string) {
  pendingQuestions.forEach((question, requestId) => {
    if (question.businessSessionId !== sessionId) return
    pendingQuestions.delete(requestId)
    pendingQuestionResponders.delete(requestId)
  })
}

export function deletePendingQuestion(requestId: string) {
  pendingQuestions.delete(requestId)
  pendingQuestionResponders.delete(requestId)
}
