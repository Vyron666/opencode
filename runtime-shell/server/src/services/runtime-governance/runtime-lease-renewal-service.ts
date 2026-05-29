import { Config } from "../../config"
import { createLogger } from "../../log"
import { renewRuntimeLeaseForSession } from "./runtime-lease-service"

const log = createLogger("runtime-lease-renewal")
const runtimeLeaseRenewTimers = new Map<string, Timer>()

function readRuntimeLeaseRenewIntervalMs() {
  // 中文/English: renew well before lease expiry, but cap the interval so long
  // leases still get background renewal while the user keeps the session open.
  return Math.min(Math.max(Math.floor(Config.runtimeLeaseDurationMs / 3), 5000), 30000)
}

export function startRuntimeLeaseAutoRenew(sessionId: string) {
  if (runtimeLeaseRenewTimers.has(sessionId)) return
  const timer = setInterval(() => {
    void renewRuntimeLeaseForSession(sessionId).catch((error) => {
      log.warn("failed to auto renew runtime lease", {
        businessSessionId: sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }, readRuntimeLeaseRenewIntervalMs())
  runtimeLeaseRenewTimers.set(sessionId, timer)
}

export function stopRuntimeLeaseAutoRenew(sessionId: string) {
  const timer = runtimeLeaseRenewTimers.get(sessionId)
  if (!timer) return
  clearInterval(timer)
  runtimeLeaseRenewTimers.delete(sessionId)
}
