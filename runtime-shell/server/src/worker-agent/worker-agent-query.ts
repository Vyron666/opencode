import type { RuntimeEntry } from "./worker-agent-types"
import { findRuntimeForQuery, listRuntimes } from "./worker-agent-store"

export function queryRuntime(url: URL) {
  const entry = findRuntimeForQuery(url)
  if (!entry) return null
  return {
    remoteRuntimeId: entry.remoteRuntimeId,
    businessSessionId: entry.businessSessionId,
    workerId: entry.workerId,
    workspacePath: entry.workspacePath,
    remoteSessionId: entry.client.getSessionId(),
    openedAt: entry.openedAt,
    lastEventAt: entry.lastEventAt,
    closing: entry.closing,
    activePrompt: entry.client.hasActivePrompt(),
    pendingPermissionCount: entry.pendingPermissions.size,
    pendingQuestionCount: entry.pendingQuestions.size,
    snapshot: entry.snapshot,
  }
}

export function queryLease(url: URL) {
  const entry = findRuntimeForQuery(url)
  if (!entry) return null
  return {
    remoteRuntimeId: entry.remoteRuntimeId,
    businessSessionId: entry.businessSessionId,
    workerId: entry.workerId,
    leaseOwner: entry.remoteRuntimeId,
    observedAt: new Date().toISOString(),
    openedAt: entry.openedAt,
    lastEventAt: entry.lastEventAt,
    closing: entry.closing,
    activePrompt: entry.client.hasActivePrompt(),
  }
}

export function queryHeartbeat(url: URL) {
  const workerId = url.searchParams.get("workerId")
  const runtimes = listRuntimes().filter((entry) => !workerId || entry.workerId === workerId)
  const lastEventAt = runtimes
    .map((entry) => entry.lastEventAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1)
  return {
    workerId: workerId || runtimes[0]?.workerId || "unknown",
    observedAt: new Date().toISOString(),
    activeRuntimeCount: runtimes.length,
    activePromptCount: runtimes.filter((entry) => entry.client.hasActivePrompt()).length,
    lastEventAt,
    status: runtimes.some((entry) => entry.client.hasActivePrompt()) ? "busy" : "ready",
  }
}

export function queryFailure(url: URL) {
  const entry = findRuntimeForQuery(url)
  if (!entry) return null
  return entry.lastFailure
    ? {
        remoteRuntimeId: entry.remoteRuntimeId,
        businessSessionId: entry.businessSessionId,
        workerId: entry.workerId,
        ...entry.lastFailure,
      }
    : null
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
