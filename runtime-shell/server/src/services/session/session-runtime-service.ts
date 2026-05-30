import { getRuntime, openRealRuntime } from "../../acp-runtime-manager"
import { createLogger } from "../../log"
import type { BusinessSession } from "../../types"
import { renewRuntimeLeaseForSession } from "../runtime-governance/runtime-lease-service"
import { markSessionActive } from "./session-status-machine-service"
import { sessionService } from "../store/store-singleton"

const log = createLogger("session-runtime-service")

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
  await openRealRuntime(session)
  return (await sessionService.getSession(session.id)) || session
}

export function preopenSessionRuntime(session: BusinessSession) {
  // 中文/English: preopen runs in background after create so the user's first explicit
  // open/prompt can reuse the same pending runtime load instead of paying the full cold start.
  void openRealRuntime(session).catch((error) => {
    log.warn("session preopen failed", {
      businessSessionId: session.id,
      workerId: session.workerId,
      message: error instanceof Error ? error.message : String(error),
    })
  })
}
