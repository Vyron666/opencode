import { store } from "../store"
import type { BusinessSession, SessionEvent } from "../types"
import { bindRuntime, createClient } from "./runtime-binding"
import { persistAndFanout } from "./runtime-events"
import {
  clearPendingPermissionsBySession,
  clearPendingQuestionsBySession,
  deleteRuntime,
  getRuntime,
  listPendingPermissions,
  listPendingQuestions,
  markClosingSession,
  resolvePendingPermission,
  subscribeRuntimeEvents,
  unmarkClosingSession,
  resolvePendingQuestion as resolvePendingQuestionInternal,
} from "./runtime-registry"
import { toElicitationContent } from "./runtime-types"

export { getRuntime, listPendingPermissions, resolvePendingPermission, listPendingQuestions, subscribeRuntimeEvents }

export function resolvePendingQuestion(
  requestId: string,
  input: { action: "accept" | "decline" | "cancel"; content?: Record<string, unknown> },
) {
  return resolvePendingQuestionInternal(requestId, input, toElicitationContent)
}

export async function openRealRuntime(session: BusinessSession) {
  const existing = getRuntime(session.id)
  if (existing) return existing
  const client = createClient(session)
  const created = await client.newSession(session.workspacePath)
  return bindRuntime(session, client, {
    sessionId: created.sessionId,
    configOptions: created.configOptions,
    models: created.models,
    modes: created.modes,
  }, "opened")
}

export async function loadRealRuntime(session: BusinessSession) {
  const existing = getRuntime(session.id)
  if (existing) return existing
  const sessionId = session.binding?.acpSessionId
  if (!sessionId) throw new Error("acp session is not bound")
  const client = createClient(session)
  const loaded = await client.loadSession(session.workspacePath, sessionId)
  return bindRuntime(session, client, {
    sessionId,
    configOptions: loaded.configOptions,
    models: loaded.models,
    modes: loaded.modes,
  }, "loaded")
}

export async function resumeRealRuntime(session: BusinessSession) {
  const existing = getRuntime(session.id)
  if (existing) return existing
  const sessionId = session.binding?.acpSessionId
  if (!sessionId) throw new Error("acp session is not bound")
  const client = createClient(session)
  const resumed = await client.resumeSession(session.workspacePath, sessionId)
  return bindRuntime(session, client, {
    sessionId,
    configOptions: resumed.configOptions,
    models: resumed.models,
    modes: resumed.modes,
  }, "resumed")
}

export async function forkRealRuntime(source: BusinessSession, target: BusinessSession) {
  const sourceRuntime = getRuntime(source.id)
  const sourceSessionId = sourceRuntime?.client.getSessionId() || source.binding?.acpSessionId
  if (!sourceSessionId) throw new Error("source session is not bound")
  const client = createClient(target)
  const forked = await client.forkSession(target.workspacePath, sourceSessionId)
  return bindRuntime(target, client, {
    sessionId: forked.sessionId,
    configOptions: forked.configOptions,
    models: forked.models,
    modes: forked.modes,
  }, "forked")
}

export async function cancelRuntimePrompt(sessionId: string) {
  const runtime = getRuntime(sessionId)
  if (!runtime) return false
  ////////////// runtime-shell customization start //////////////
  // 中文/English: return to the frontend immediately after the cancel request is dispatched.
  // The turn still ends only when upstream abort actually resolves and emits stop events.
  void runtime.client.cancel()
  ////////////// runtime-shell customization end //////////////
  return true
}

export async function publishRuntimeEvent(event: SessionEvent) {
  await persistAndFanout(event)
}

export async function closeRuntime(sessionId: string) {
  const runtime = getRuntime(sessionId)
  if (!runtime) return false
  const session = store.getSession(sessionId)
  deleteRuntime(sessionId)
  clearPendingPermissionsBySession(sessionId)
  clearPendingQuestionsBySession(sessionId)
  markClosingSession(sessionId)
  if (session) {
    await persistAndFanout({
      eventId: `evt_${crypto.randomUUID().replace(/-/g, "")}`,
      eventType: "session_closed",
      businessSessionId: session.id,
      acpSessionId: session.binding?.acpSessionId,
      workerId: session.workerId,
      timestamp: new Date().toISOString(),
      payload: {
        transport: runtime.transport,
      },
    })
  }
  await runtime.client.close()
  unmarkClosingSession(sessionId)
  return true
}
