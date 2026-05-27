import type { BusinessSession, SessionEvent } from "../../types"

export function createSessionEvent(
  session: BusinessSession,
  eventType: SessionEvent["eventType"],
  payload: Record<string, unknown>,
): SessionEvent {
  return {
    eventId: `evt_${crypto.randomUUID().replace(/-/g, "")}`,
    eventType,
    businessSessionId: session.id,
    // 中文/English: callers must pass the latest persisted session snapshot after runtime binding changes.
    acpSessionId: session.binding?.acpSessionId,
    workerId: session.workerId,
    timestamp: new Date().toISOString(),
    payload,
  }
}
