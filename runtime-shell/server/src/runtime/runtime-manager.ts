import { sessionService } from "../services/store/store-singleton"
import type { BusinessSession, SessionEvent } from "../types"
import { bindRuntime, createClient } from "./runtime-binding"
import { persistAndFanout } from "./runtime-events"
import type { RuntimeEntry } from "./runtime-types"
import { buildSessionConfigOverride } from "../services/configuration/configuration-service"
import { userService } from "../services/store/store-singleton"
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
  resolvePendingQuestion as resolvePendingQuestionInternal,
} from "./runtime-registry"
import { toElicitationContent } from "./runtime-types"
import { stopRuntimeLeaseAutoRenew } from "../services/runtime-governance/runtime-lease-renewal-service"
import { createLogger } from "../log"

export { getRuntime, listPendingPermissions, resolvePendingPermission, listPendingQuestions, subscribeRuntimeEvents }

const pendingRuntimeLoads = new Map<string, Promise<RuntimeEntry>>()
const log = createLogger("runtime-manager")

export function resolvePendingQuestion(
  requestId: string,
  input: { action: "accept" | "decline" | "cancel"; content?: Record<string, unknown> },
) {
  return resolvePendingQuestionInternal(requestId, input, toElicitationContent)
}

export async function openRealRuntime(session: BusinessSession) {
  const existing = getRuntime(session.id)
  if (existing) return existing
  const pending = pendingRuntimeLoads.get(session.id)
  if (pending) return pending
  const client = await createClientWithConfig(session)
  const task = client.newSession(session.workspacePath)
    .then((created) =>
      bindRuntime(session, client, {
        sessionId: created.sessionId,
        configOptions: created.configOptions,
        models: created.models,
        modes: created.modes,
      }, "opened"))
    .catch((error) => {
      log.warn("open real runtime failed", {
        businessSessionId: session.id,
        workerId: session.workerId,
        workspacePath: session.workspacePath,
        message: error instanceof Error ? error.message : String(error),
      })
      throw error
    })
  pendingRuntimeLoads.set(session.id, task)
  return task.finally(() => pendingRuntimeLoads.delete(session.id))
}

export async function loadRealRuntime(session: BusinessSession) {
  const existing = getRuntime(session.id)
  if (existing) return existing
  const pending = pendingRuntimeLoads.get(session.id)
  if (pending) return pending
  const sessionId = session.binding?.acpSessionId
  if (!sessionId) throw new Error("acp session is not bound")
  const client = await createClientWithConfig(session)
  const task = client.loadSession(session.workspacePath, sessionId)
    .then((loaded) =>
      bindRuntime(session, client, {
        sessionId,
        configOptions: loaded.configOptions,
        models: loaded.models,
        modes: loaded.modes,
      }, "loaded"))
    .catch((error) => recoverMissingAcpSession(session, client, sessionId, error, "loadSession"))
  pendingRuntimeLoads.set(session.id, task)
  return task.finally(() => pendingRuntimeLoads.delete(session.id))
}

export async function resumeRealRuntime(session: BusinessSession) {
  const existing = getRuntime(session.id)
  if (existing) return existing
  const pending = pendingRuntimeLoads.get(session.id)
  if (pending) return pending
  const sessionId = session.binding?.acpSessionId
  if (!sessionId) throw new Error("acp session is not bound")
  const client = await createClientWithConfig(session)
  const task = client.resumeSession(session.workspacePath, sessionId)
    .then((resumed) =>
      bindRuntime(session, client, {
        sessionId,
        configOptions: resumed.configOptions,
        models: resumed.models,
        modes: resumed.modes,
      }, "resumed"))
    .catch((error) => recoverMissingAcpSession(session, client, sessionId, error, "resumeSession"))
  pendingRuntimeLoads.set(session.id, task)
  return task.finally(() => pendingRuntimeLoads.delete(session.id))
}

export async function forkRealRuntime(source: BusinessSession, target: BusinessSession) {
  const sourceRuntime = getRuntime(source.id)
  const sourceSessionId = sourceRuntime?.client.getSessionId() || source.binding?.acpSessionId
  if (!sourceSessionId) throw new Error("source session is not bound")
  const client = await createClientWithConfig(target)
  const forked = await client.forkSession(target.workspacePath, sourceSessionId)
  return bindRuntime(target, client, {
    sessionId: forked.sessionId,
    configOptions: forked.configOptions,
    models: forked.models,
    modes: forked.modes,
  }, "forked")
}

async function createClientWithConfig(session: BusinessSession) {
  const owner = await userService.getUser(session.createdBy)
  if (!owner) return createClient(session)
  const override = await buildSessionConfigOverride(owner)
  const configContent = JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    ...override,
  })
  return createClient(session, configContent)
}

async function recoverMissingAcpSession(
  session: BusinessSession,
  client: Awaited<ReturnType<typeof createClientWithConfig>>,
  acpSessionId: string,
  error: unknown,
  step: "loadSession" | "resumeSession",
) {
  if (!isAcpSessionNotFound(error)) throw error
  log.warn("persisted ACP session missing, opening a fresh runtime session", {
    businessSessionId: session.id,
    workerId: session.workerId,
    workspacePath: session.workspacePath,
    acpSessionId,
    step,
  })
  // 中文/English: rebuilding images or switching sandbox workspaces can leave a
  // business session pointing at an ACP session that no longer exists on disk.
  // Keep the business history, but bind a fresh ACP session so capabilities reload.
  const created = await client.newSession(session.workspacePath)
  return bindRuntime(session, client, {
    sessionId: created.sessionId,
    configOptions: created.configOptions,
    models: created.models,
    modes: created.modes,
  }, "opened")
}

function isAcpSessionNotFound(error: unknown) {
  if (!(error instanceof Error)) return false
  return /Session not found:\s*ses_/i.test(error.message)
}

export async function cancelRuntimePrompt(sessionId: string) {
  const runtime = getRuntime(sessionId)
  if (!runtime) return false
  if (!runtime.client.hasActivePrompt()) return false
  ////////////// runtime-shell customization start //////////////
  // 中文/English: wait until ACP accepts the cancel request so transport errors
  // surface immediately. The turn still ends only on real upstream stop events.
  await runtime.client.cancel()
  ////////////// runtime-shell customization end //////////////
  return true
}

export async function publishRuntimeEvent(event: SessionEvent) {
  await persistAndFanout(event)
}

export async function closeRuntime(sessionId: string) {
  const runtime = getRuntime(sessionId)
  if (!runtime) return false
  const session = await sessionService.getSession(sessionId)
  stopRuntimeLeaseAutoRenew(sessionId)
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
  // 中文/English: keep the closing mark until the real ACP exit callback consumes it.
  // Clearing it here is racy because `close()` can resolve before the process exit event arrives.
  return true
}
