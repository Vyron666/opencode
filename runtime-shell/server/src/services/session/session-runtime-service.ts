import { getRuntime, openRealRuntime, prewarmRealRuntime } from "../../acp-runtime-manager"
import { createLogger } from "../../log"
import type { BusinessSession } from "../../types"
import { renewRuntimeLeaseForSession } from "../runtime-governance/runtime-lease-service"
import { markSessionActive } from "./session-status-machine-service"
import { sessionService } from "../store/store-singleton"

const log = createLogger("session-runtime-service")
const pendingSessionPrewarms = new Map<string, Promise<void>>()

export async function openSessionWithFallback(session: BusinessSession) {
  const existingRuntime = getRuntime(session.id)
  if (existingRuntime) {
    // 中文/English: reopening an already-live runtime should converge the persisted
    // session state back to active instead of leaving it stuck at opening.
    await markSessionActive(session.id)
    await renewRuntimeLeaseForSession(session.id)
    return (await sessionService.getSession(session.id)) || session
  }
  // 中文/English: runtime-shell only supports a real ACP runtime; workspace
  // binding validation must already be completed before this runtime bridge runs.
  try {
    await openRealRuntime(session)
  } catch (error) {
    log.warn("session open failed", {
      businessSessionId: session.id,
      workerId: session.workerId,
      workspacePath: session.workspacePath,
      message: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
  return (await sessionService.getSession(session.id)) || session
}

export async function ensureSessionRuntimePrewarmed(session: BusinessSession) {
  if (getRuntime(session.id)) return
  const pending = pendingSessionPrewarms.get(session.id)
  if (pending) return pending
  const task = prewarmRealRuntime(session)
  pendingSessionPrewarms.set(session.id, task)
  try {
    await task
  } finally {
    if (pendingSessionPrewarms.get(session.id) === task) {
      pendingSessionPrewarms.delete(session.id)
    }
  }
}

export function preopenSessionRuntime(session: BusinessSession) {
  // 中文/English: create warmup and explicit open must share one prewarm promise,
  // otherwise fast create->open traffic races the background warm path and falls
  // back to a full cold runtime bootstrap.
  void ensureSessionRuntimePrewarmed(session).catch((error) => {
    log.warn("session preopen failed", {
      businessSessionId: session.id,
      workerId: session.workerId,
      message: error instanceof Error ? error.message : String(error),
    })
  })
}
