import type { BusinessSessionPatch, PersistedState, SessionEvent } from "../types"
import { listEvents, stageSessionEvent } from "./state-repo"
import { patchSession } from "./session-write-repo"

export async function stageEvent(state: PersistedState, event: SessionEvent, sessionPatch?: BusinessSessionPatch) {
  stageSessionEvent(state, event)
  if (!sessionPatch) return
  return patchSession(event.businessSessionId, sessionPatch)
}

export function listSessionEvents(state: PersistedState, sessionId: string, afterEventId?: string) {
  return listEvents(state, sessionId, afterEventId)
}
