import { createLogger } from "../log"
import type { SessionEvent } from "../types"
import type { RuntimeEntry } from "./worker-agent-types"

const log = createLogger("worker-agent")

export function beginPromptTrace(entry: RuntimeEntry, partCount: number) {
  const acceptedAtMs = Date.now()
  entry.activePromptTrace = {
    acceptedAt: new Date(acceptedAtMs).toISOString(),
    acceptedAtMs,
  }
  log.info("remote prompt accepted", {
    businessSessionId: entry.businessSessionId,
    workerId: entry.workerId,
    remoteRuntimeId: entry.remoteRuntimeId,
    remoteSessionId: entry.client.getSessionId(),
    partCount,
  })
}

export function finishPromptTrace(entry: RuntimeEntry, stopReason?: string) {
  logPromptTrace(entry, "completed", undefined, stopReason)
  entry.activePromptTrace = undefined
}

export function failPromptTrace(entry: RuntimeEntry, message: string) {
  logPromptTrace(entry, "failed", undefined, undefined, message)
  entry.activePromptTrace = undefined
}

export function clearPromptTrace(entry: RuntimeEntry) {
  entry.activePromptTrace = undefined
}

export function recordPromptEventTrace(entry: RuntimeEntry, event: SessionEvent) {
  if (!entry.activePromptTrace) return
  if (!entry.activePromptTrace.firstUpstreamEventAt) {
    entry.activePromptTrace = { ...entry.activePromptTrace, firstUpstreamEventAt: event.timestamp }
    logPromptTrace(entry, "first_upstream_event", event.eventType)
  }
  if (!isFirstVisiblePromptEvent(event) || entry.activePromptTrace.firstVisibleEventAt) return
  entry.activePromptTrace = { ...entry.activePromptTrace, firstVisibleEventAt: event.timestamp }
  logPromptTrace(entry, "first_visible_event", event.eventType)
}

function isFirstVisiblePromptEvent(event: SessionEvent) {
  return ["agent_message_chunk", "agent_thought_chunk", "tool_call", "tool_call_update", "plan", "permission_requested", "question_requested"].includes(event.eventType)
}

function logPromptTrace(
  entry: RuntimeEntry,
  stage: "first_upstream_event" | "first_visible_event" | "completed" | "failed",
  eventType?: SessionEvent["eventType"],
  stopReason?: string,
  message?: string,
) {
  if (!entry.activePromptTrace) return
  const firstUpstreamEventDelayMs = entry.activePromptTrace.firstUpstreamEventAt
    ? new Date(entry.activePromptTrace.firstUpstreamEventAt).getTime() - entry.activePromptTrace.acceptedAtMs
    : undefined
  const firstVisibleEventDelayMs = entry.activePromptTrace.firstVisibleEventAt
    ? new Date(entry.activePromptTrace.firstVisibleEventAt).getTime() - entry.activePromptTrace.acceptedAtMs
    : undefined
  log.info("remote prompt trace", {
    businessSessionId: entry.businessSessionId,
    workerId: entry.workerId,
    remoteRuntimeId: entry.remoteRuntimeId,
    remoteSessionId: entry.client.getSessionId(),
    stage,
    eventType,
    stopReason,
    message,
    firstUpstreamEventDelayMs,
    firstVisibleEventDelayMs,
    totalDurationMs: Date.now() - entry.activePromptTrace.acceptedAtMs,
  })
}
