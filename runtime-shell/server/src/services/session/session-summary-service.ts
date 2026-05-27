import { listPendingPermissions, listPendingQuestions } from "../../acp-runtime-manager"
import { sessionService } from "../store/store-singleton"
import type { BusinessSession } from "../../types"

export function sessionSummary(session: BusinessSession) {
  return {
    ...session,
    eventCount: sessionService.listEvents(session.id).length,
    pendingPermissions: listPendingPermissions(session.id),
    pendingQuestions: listPendingQuestions(session.id),
  }
}
