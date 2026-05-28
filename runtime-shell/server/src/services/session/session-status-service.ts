import { setSessionStatus } from "./session-lifecycle-service"

export async function markSessionOpening(sessionId: string) {
  return setSessionStatus(sessionId, "opening")
}

export async function markSessionWaitingInput(sessionId: string) {
  return setSessionStatus(sessionId, "waiting_input")
}

export async function markSessionCancelling(sessionId: string) {
  return setSessionStatus(sessionId, "cancelling")
}

export async function markSessionClosing(sessionId: string) {
  return setSessionStatus(sessionId, "closing")
}

export async function markSessionActive(sessionId: string) {
  return setSessionStatus(sessionId, "active")
}

export async function markSessionFailed(sessionId: string) {
  return setSessionStatus(sessionId, "failed")
}

export async function markSessionOrphaned(sessionId: string) {
  return setSessionStatus(sessionId, "orphaned")
}

export async function markSessionCreated(sessionId: string) {
  return setSessionStatus(sessionId, "created")
}

export async function markSessionCompleted(sessionId: string) {
  return setSessionStatus(sessionId, "completed")
}
