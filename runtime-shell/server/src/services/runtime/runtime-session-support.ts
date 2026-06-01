import type { BusinessSession } from "../../types"
import { getLatestRuntimeBinding } from "../runtime-governance/runtime-binding-service"
import { markSessionActive, markSessionFailed } from "../session/session-status-machine-service"
import { sessionService } from "../store/store-singleton"

export async function requireLiveSession(sessionId: string): Promise<BusinessSession> {
  const session = await sessionService.getSession(sessionId)
  if (!session) throw new Error(`session not found: ${sessionId}`)
  return session
}

export async function restoreActiveSessionIfRunning(sessionId: string) {
  const session = await requireLiveSession(sessionId)
  if (session.status !== "waiting_input" && session.status !== "cancelling") return
  await markSessionActive(sessionId)
  return requireLiveSession(sessionId)
}

export async function markSessionFailedIfRunning(sessionId: string) {
  const session = await requireLiveSession(sessionId)
  if (session.status !== "waiting_input" && session.status !== "cancelling") return
  await markSessionFailed(sessionId)
  return requireLiveSession(sessionId)
}

export function isPromptAborted(error: unknown) {
  if (!(error instanceof Error)) return false
  // 中文/English: closing a session can reject the in-flight prompt as
  // "ACP runtime closed/exited"; treat that as a normal interruption, not failure.
  return error.name === "MessageAbortedError" || /aborted|cancelled|canceled|runtime (closed|exited)/i.test(error.message)
}

export async function restoreSessionBindingForHistory(session: BusinessSession) {
  if (session.binding?.acpSessionId) return session
  const latestBinding = await getLatestRuntimeBinding(session.id)
  if (!latestBinding?.acpSessionId || !latestBinding.runtimeKey) return session
  if (session.workerId !== latestBinding.workerId) {
    await sessionService.updateSession(session.id, {
      workerId: latestBinding.workerId,
    })
  }
  return {
    ...session,
    workerId: latestBinding.workerId,
    binding: {
      acpSessionId: latestBinding.acpSessionId,
      runtimeKey: latestBinding.runtimeKey,
      openedAt: latestBinding.boundAt,
      transport: "real" as const,
    },
  }
}
