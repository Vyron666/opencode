import { sessionService } from "../services/store/store-singleton"
import type { BusinessSession, SessionEvent } from "../types"
import { bindRuntime, createClient } from "./runtime-binding"
import { persistAndFanout } from "./runtime-events"
import type { RuntimeEntry, SessionBootstrap } from "./runtime-types"
import { buildSessionConfigOverride } from "../services/configuration/configuration-service"
import { rememberWarmRuntimeDemand } from "../services/sandbox/warm-runtime-demand-service"
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
import { closeRemoteRuntimeBinding } from "./remote-runtime-client"
import { RemoteRuntimeClient } from "./remote-runtime-client"
import { buildRuntimeConfigContent } from "./runtime-config-content"
import { rebuildMissingAcpSessionFromRuntimeHome } from "../services/runtime/runtime-session-rebuild-service"
import type { ManagedRuntimeClient } from "./runtime-client"

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
  return withPendingRuntimeLoad(session, async () => {
    const client = await createClientWithConfig(session)
    return client.newSession(session.workspacePath)
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
  })
}

export async function prewarmRealRuntime(session: BusinessSession) {
  const client = await createClientWithConfig(session)
  if (!(client instanceof RemoteRuntimeClient) || !client.prewarm) return
  await client.prewarm()
}

export async function loadRealRuntime(session: BusinessSession) {
  const sessionId = session.binding?.acpSessionId
  if (!sessionId) throw new Error("acp session is not bound")
  return withPendingRuntimeLoad(session, async () => {
    const client = await createClientWithConfig(session)
    try {
      const loaded = await client.loadSession(session.workspacePath, sessionId)
      return bindRuntime(session, client, {
        sessionId,
        configOptions: loaded.configOptions,
        models: loaded.models,
        modes: loaded.modes,
      }, "loaded")
    } catch (error) {
      return recoverMissingAcpSession(session, client, sessionId, error, "loadSession")
    }
  })
}

export async function resumeRealRuntime(session: BusinessSession) {
  const sessionId = session.binding?.acpSessionId
  if (!sessionId) throw new Error("acp session is not bound")
  return withPendingRuntimeLoad(session, async () => {
    const client = await createClientWithConfig(session)
    try {
      const resumed = await client.resumeSession(session.workspacePath, sessionId)
      return bindRuntime(session, client, {
        sessionId,
        configOptions: resumed.configOptions,
        models: resumed.models,
        modes: resumed.modes,
      }, "resumed")
    } catch (error) {
      return recoverMissingAcpSession(session, client, sessionId, error, "resumeSession")
    }
  })
}

export async function forkRealRuntime(source: BusinessSession, target: BusinessSession) {
  const sourceRuntime = getRuntime(source.id)
  const sourceSessionId = sourceRuntime?.client.getSessionId() || source.binding?.acpSessionId
  if (!sourceSessionId) throw new Error("source session is not bound")
  const client = await createClientWithConfig(target)
  const forked = await client.forkSession(target.workspacePath, sourceSessionId, {
    sourceBusinessSessionId: source.id,
  })
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
  const configContent = buildRuntimeConfigContent({
    $schema: "https://opencode.ai/config.json",
    ...override,
  })
  rememberWarmRuntimeDemand(configContent)
  return createClient(session, configContent)
}

async function withPendingRuntimeLoad(session: BusinessSession, taskFactory: () => Promise<RuntimeEntry>) {
  const existing = getRuntime(session.id)
  if (existing) return existing
  const pending = pendingRuntimeLoads.get(session.id)
  if (pending) return pending
  const task = taskFactory()
  pendingRuntimeLoads.set(session.id, task)
  return task.finally(() => pendingRuntimeLoads.delete(session.id))
}

async function recoverMissingAcpSession(
  session: BusinessSession,
  client: Awaited<ReturnType<typeof createClientWithConfig>>,
  acpSessionId: string,
  error: unknown,
  step: "loadSession" | "resumeSession",
) {
  if (!isAcpSessionNotFound(error)) throw error
  log.warn("persisted ACP session missing, rebuilding it from runtime home history", {
    businessSessionId: session.id,
    workerId: session.workerId,
    workspacePath: session.workspacePath,
    acpSessionId,
    step,
  })
  return recoverMissingAcpSessionForTest({
    session,
    client,
    acpSessionId,
    step,
    rebuildMissingAcpSession: (input) => rebuildMissingAcpSessionFromRuntimeHome(input),
    bindRecoveredRuntime: (targetSession, targetClient, response) =>
      bindRuntime(targetSession, targetClient, response, "loaded"),
  })
}

type RecoverMissingAcpSessionClient = Pick<ManagedRuntimeClient, "loadSession" | "getSessionId"> &
  Partial<Pick<ManagedRuntimeClient, "rebuildSession">>

type RecoverMissingAcpSessionInput = {
  session: BusinessSession
  client: RecoverMissingAcpSessionClient
  acpSessionId: string
  step: "loadSession" | "resumeSession"
  rebuildMissingAcpSession: (input: {
    session: BusinessSession
    missingAcpSessionId: string
  }) => Promise<{ sessionId: string }>
  bindRecoveredRuntime: (
    session: BusinessSession,
    client: ManagedRuntimeClient,
    response: SessionBootstrap,
  ) => Promise<RuntimeEntry>
}

export async function recoverMissingAcpSessionForTest(input: RecoverMissingAcpSessionInput) {
  if (typeof input.client.rebuildSession === "function") {
    const loaded = await input.client.rebuildSession(input.session.workspacePath, input.acpSessionId)
    // 中文/English: remote workers rebuild from their own runtime-home snapshot,
    // so the shell must not require a local DB clone before rebinding.
    return input.bindRecoveredRuntime(input.session, input.client as ManagedRuntimeClient, {
      sessionId: input.client.getSessionId() || input.acpSessionId,
      configOptions: loaded.configOptions,
      models: loaded.models,
      modes: loaded.modes,
    })
  }

  const rebuilt = await input.rebuildMissingAcpSession({
    session: input.session,
    missingAcpSessionId: input.acpSessionId,
  })
  const loaded = await input.client.loadSession(input.session.workspacePath, rebuilt.sessionId)
  // 中文/English: bind the recovered ACP session back onto the original business
  // session so history, tool state, and follow-up turns stay on one session line.
  return input.bindRecoveredRuntime(input.session, input.client as ManagedRuntimeClient, {
    sessionId: input.client.getSessionId() || rebuilt.sessionId,
    configOptions: loaded.configOptions,
    models: loaded.models,
    modes: loaded.modes,
  })
}

function isAcpSessionNotFound(error: unknown) {
  if (!(error instanceof Error)) return false
  return /Session not found:\s*ses_/i.test(error.message)
}

export async function cancelRuntimePrompt(sessionId: string) {
  const runtime = getRuntime(sessionId)
  if (!runtime) return false
  if (!runtime.client.hasActivePrompt()) return false
  // 中文/English: wait until ACP accepts the cancel request so transport errors
  // surface immediately. The turn still ends only on real upstream stop events.
  await runtime.client.cancel()
  return true
}

export async function publishRuntimeEvent(event: SessionEvent) {
  await persistAndFanout(event)
}

export async function closeRuntime(sessionId: string) {
  const runtime = getRuntime(sessionId)
  const session = await sessionService.getSession(sessionId)
  if (!runtime) {
    if (!session) return false
    await closeRemoteRuntimeBinding(session).catch(() => false)
    return false
  }
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
