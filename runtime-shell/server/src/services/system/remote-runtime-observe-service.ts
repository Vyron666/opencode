import { Config, findLocalWorkerConfig } from "../../config"
import type { BusinessSession } from "../../types"

export async function queryRemoteRuntimeForSession(session: BusinessSession) {
  return queryRemoteRuntimeObserve("/runtime/query-runtime", session)
}

export async function queryRemoteLeaseForSession(session: BusinessSession) {
  return queryRemoteRuntimeObserve("/runtime/query-lease", session)
}

export async function queryRemoteFailureForSession(session: BusinessSession) {
  return queryRemoteRuntimeObserve("/runtime/query-failure", session)
}

export async function queryRemoteHeartbeatForWorker(workerId: string) {
  if (Config.workerExecutionMode !== "remote") return null
  const worker = findLocalWorkerConfig(workerId)
  if (!worker?.agentBaseUrl) return null
  const url = new URL(`${worker.agentBaseUrl}/runtime/query-heartbeat`)
  url.searchParams.set("workerId", workerId)
  return fetchRemoteObservation(url)
}

async function queryRemoteRuntimeObserve(pathname: string, session: BusinessSession) {
  if (Config.workerExecutionMode !== "remote" || !session.binding?.runtimeKey) return null
  const worker = findLocalWorkerConfig(session.workerId)
  if (!worker?.agentBaseUrl) return null
  const url = new URL(`${worker.agentBaseUrl}${pathname}`)
  url.searchParams.set("remoteRuntimeId", session.binding.runtimeKey)
  url.searchParams.set("businessSessionId", session.id)
  return fetchRemoteObservation(url)
}

async function fetchRemoteObservation(url: URL) {
  try {
    const response = await fetch(url, {
      headers: {
        "x-runtime-worker-token": Config.workerAgentToken,
      },
    })
    if (!response.ok) return null
    return response.json() as Promise<unknown>
  } catch {
    // 中文/English: remote observation is best-effort only. Once a worker is
    // offline, governance detail APIs must degrade to persisted state instead of 500.
    return null
  }
}
