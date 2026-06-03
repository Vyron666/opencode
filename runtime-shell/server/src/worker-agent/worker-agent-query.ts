import { statfsSync } from "node:fs"
import os from "node:os"
import { Config } from "../config"
import type { RuntimeEntry } from "./worker-agent-types"
import { getDockerWarmPoolSnapshot } from "./sandbox/docker-sandbox-manager"
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
  const warmPoolSnapshot = workerId ? getDockerWarmPoolSnapshot(workerId) : undefined
  const workerWarmPool = warmPoolSnapshot && "readyCount" in warmPoolSnapshot ? warmPoolSnapshot : undefined
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
    warmPoolReady: workerWarmPool?.readyCount ?? 0,
    warmPoolLeased: workerWarmPool?.leasedCount ?? 0,
    warmPoolTarget: workerWarmPool?.target ?? 0,
    lastEventAt,
    status: runtimes.some((entry) => entry.client.hasActivePrompt()) ? "busy" : "ready",
    ...readWorkerResourceUsage(),
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

function readWorkerResourceUsage() {
  const cpuCount = Math.max(1, os.cpus().length)
  const cpuPercent = Math.max(0, Math.min(100, (os.loadavg()[0] / cpuCount) * 100))
  const memoryBytes = Math.max(0, os.totalmem() - os.freemem())
  return {
    cpuPercent: Number(cpuPercent.toFixed(2)),
    memoryBytes,
    diskBytes: readWorkspaceDiskBytes(),
  }
}

function readWorkspaceDiskBytes() {
  try {
    const stats = statfsSync(Config.workspaceRootDir)
    const value = Number((stats.blocks - stats.bfree) * stats.bsize)
    if (Number.isFinite(value) && value >= 0) return value
  } catch {}
  return undefined
}
