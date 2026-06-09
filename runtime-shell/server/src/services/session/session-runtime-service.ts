import { getRuntime, loadRealRuntime, openRealRuntime, prewarmRealRuntime, resumeRealRuntime } from "../../acp-runtime-manager"
import { createLogger } from "../../log"
import type { BusinessSession } from "../../types"
import { renewRuntimeLeaseForSession } from "../runtime-governance/runtime-lease-service"
import { restoreSessionBindingForHistory } from "../runtime/runtime-session-support"
import { markSessionActive } from "./session-status-machine-service"
import { sessionService } from "../store/store-singleton"

const log = createLogger("session-runtime-service")
const pendingSessionPrewarms = new Map<string, Promise<void>>()
const SESSION_OPEN_PREWARM_WAIT_MS = 1_500

export async function openSessionWithFallback(session: BusinessSession) {
  const existingRuntime = getRuntime(session.id)
  if (existingRuntime) {
    // 中文/English: reopening an already-live runtime should converge the persisted
    // session state back to active instead of leaving it stuck at opening.
    await markSessionActive(session.id)
    await renewRuntimeLeaseForSession(session.id)
    return (await sessionService.getSession(session.id)) || session
  }

  const recoverableSession = await restoreSessionBindingForHistory(session)
  try {
    // 中文/English: the same business session must keep reusing its persisted ACP
    // session whenever possible; opening a fresh ACP session here would silently
    // cut off prior dialog memory, tool state, and summary continuity.
    if (recoverableSession.binding?.acpSessionId) {
      try {
        await resumeRealRuntime(recoverableSession)
      } catch (resumeError) {
        log.warn("session resume failed, retrying persisted load", {
          businessSessionId: recoverableSession.id,
          workerId: recoverableSession.workerId,
          workspacePath: recoverableSession.workspacePath,
          message: resumeError instanceof Error ? resumeError.message : String(resumeError),
        })
        await loadRealRuntime(recoverableSession)
      }
    } else {
      // 中文/English: only sessions without any persisted ACP binding should create
      // a brand-new runtime conversation boundary.
      await openRealRuntime(recoverableSession)
    }
  } catch (error) {
    log.warn("session open failed", {
      businessSessionId: recoverableSession.id,
      workerId: recoverableSession.workerId,
      workspacePath: recoverableSession.workspacePath,
      message: error instanceof Error ? error.message : String(error),
    })
    throw error
  }

  return (await sessionService.getSession(recoverableSession.id)) || recoverableSession
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

export async function waitForSessionRuntimePrewarmed(session: BusinessSession, waitMs = SESSION_OPEN_PREWARM_WAIT_MS) {
  const prewarm = ensureSessionRuntimePrewarmed(session)
  await Promise.race([
    prewarm.catch(() => {}),
    Bun.sleep(waitMs),
  ])
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
