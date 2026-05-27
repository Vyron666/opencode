import { openRealRuntime } from "../../acp-runtime-manager"
import { sessionService } from "../store/store-singleton"
import type { BusinessSession } from "../../types"

export async function openSessionWithFallback(session: BusinessSession) {
  // 中文/English: runtime-shell only supports a real ACP runtime; workspace
  // binding validation must already be completed before this runtime bridge runs.
  const opened = await openRealRuntime(session)
  return (await sessionService.getSession(session.id)) || sessionService.getSession(opened.client.getSessionId())
}
