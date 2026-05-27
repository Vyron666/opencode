import type { AcpBinding, SessionCapabilityState, SessionStatus } from "../../types"
import { sessionService } from "../store/store-singleton"

export async function activateSessionRuntime(input: {
  sessionId: string
  binding: AcpBinding
  capabilityState?: SessionCapabilityState
}) {
  return sessionService.updateSession(input.sessionId, {
    status: "active",
    binding: input.binding,
    capabilityState: input.capabilityState,
  })
}

export async function resetSessionRuntime(sessionId: string, status: InactiveSessionStatus) {
  // 中文/English: once a runtime is closed or lost, the ACP binding must be cleared
  // so follow-up load/resume logic does not rely on a stale session id.
  return sessionService.updateSession(sessionId, {
    status,
    binding: null,
  })
}

export async function setSessionStatus(sessionId: string, status: SessionStatus) {
  // 中文/English: prompt completion updates only the lifecycle status and keeps
  // the live runtime binding intact for the next turn in the same session.
  return sessionService.updateSession(sessionId, {
    status,
  })
}

type InactiveSessionStatus = Extract<SessionStatus, "created" | "completed" | "failed">
