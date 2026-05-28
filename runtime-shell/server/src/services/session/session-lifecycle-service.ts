import type { AcpBinding, SessionCapabilityState, SessionStatus } from "../../types"
import { markRuntimeBindingBound, markRuntimeBindingLost, releaseRuntimeBinding } from "../runtime-governance/runtime-binding-service"
import { refreshRuntimeLease, releaseRuntimeLease } from "../runtime-governance/runtime-lease-service"
import { sessionService } from "../store/store-singleton"

export async function activateSessionRuntime(input: {
  sessionId: string
  binding: AcpBinding
  capabilityState?: SessionCapabilityState
}) {
  const updated = await sessionService.updateSession(input.sessionId, {
    status: "active",
    binding: input.binding,
    capabilityState: input.capabilityState,
  })
  await markRuntimeBindingBound({
    sessionId: input.sessionId,
    acpSessionId: input.binding.acpSessionId,
    runtimeKey: input.binding.runtimeKey,
  })
  const liveSession = updated || (await sessionService.getSession(input.sessionId))
  if (liveSession) {
    await refreshRuntimeLease({
      businessSessionId: input.sessionId,
      workerId: liveSession.workerId,
      // 中文/English: runtimeKey identifies the current runtime holder, while workerId
      // keeps the node ownership explicit for offline detection and safe cleanup.
      leaseOwner: input.binding.runtimeKey,
    })
  }
  return updated
}

export async function resetSessionRuntime(sessionId: string, status: InactiveSessionStatus) {
  // 中文/English: clear the persisted ACP binding on the session first, then
  // update the runtime binding record so worker load calculations see the new session status.
  const updated = await sessionService.updateSession(sessionId, {
    status,
    binding: null,
  })
  if (status === "completed") {
    await releaseRuntimeBinding(sessionId)
  }
  if (status === "failed" || status === "orphaned") {
    await markRuntimeBindingLost(sessionId)
  }
  await releaseRuntimeLease(sessionId)
  return updated
}

export async function setSessionStatus(sessionId: string, status: SessionStatus) {
  // 中文/English: prompt completion updates only the lifecycle status and keeps
  // the live runtime binding intact for the next turn in the same session.
  return sessionService.updateSession(sessionId, {
    status,
  })
}

type InactiveSessionStatus = Extract<SessionStatus, "created" | "completed" | "failed" | "orphaned">
