import {
  cancelRuntimePrompt,
  forkRealRuntime,
  getRuntime,
  loadRealRuntime,
  openRealRuntime,
  publishRuntimeEvent,
  resumeRealRuntime,
} from "../../acp-runtime-manager"
import type { inputPartSchema } from "../../http/schemas"
import { createLogger } from "../../log"
import type { BusinessSession, User } from "../../types"
import { requireSessionAction } from "../session/session-access-service"
import { createSessionEvent } from "../session/session-event-service"
import {
  markSessionActive,
  markSessionCancelling,
  markSessionFailed,
  markSessionWaitingInput,
} from "../session/session-status-machine-service"
import { buildSessionViewForUser } from "../session/session-summary-service"
import { getLatestRuntimeBinding } from "../runtime-governance/runtime-binding-service"
import { renewRuntimeLeaseForSession } from "../runtime-governance/runtime-lease-service"
import { requireRuntimeSessionWorkspace } from "../workspace/workspace-access-service"
import { auditService, sessionService } from "../store/store-singleton"
import { withLocaleGuidance } from "./runtime-input-service"
import type { z } from "zod"

const log = createLogger("runtime-service")

export async function loadSessionRuntimeForUser(input: {
  user: User
  businessSessionId: string
}) {
  const result = await requireSessionAction({
    user: input.user,
    sessionId: input.businessSessionId,
    action: "load",
  })
  if (!result.ok) return result
  const workspaceResult = await requireRuntimeSessionWorkspace({
    user: input.user,
    session: await restoreSessionBindingForHistory(result.session),
  })
  if (!workspaceResult.ok) return workspaceResult
  await loadRealRuntime(workspaceResult.session)
  const loaded = await sessionService.getSession(result.session.id)
  if (!loaded) return { ok: false as const, reason: "session_not_found" }
  return { ok: true as const, session: await buildSessionViewForUser(input.user, loaded) }
}

export async function resumeSessionRuntimeForUser(input: {
  user: User
  businessSessionId: string
}) {
  const result = await requireSessionAction({
    user: input.user,
    sessionId: input.businessSessionId,
    action: "resume",
  })
  if (!result.ok) return result
  const workspaceResult = await requireRuntimeSessionWorkspace({
    user: input.user,
    session: await restoreSessionBindingForHistory(result.session),
  })
  if (!workspaceResult.ok) return workspaceResult
  await resumeRealRuntime(workspaceResult.session)
  const resumed = await sessionService.getSession(result.session.id)
  if (!resumed) return { ok: false as const, reason: "session_not_found" }
  return { ok: true as const, session: await buildSessionViewForUser(input.user, resumed) }
}

export async function forkSessionRuntimeForUser(input: {
  user: User
  businessSessionId: string
  title: string
}) {
  const result = await requireSessionAction({
    user: input.user,
    sessionId: input.businessSessionId,
    action: "fork",
  })
  if (!result.ok) return result
  const forkedSession = await sessionService.forkSession({
    source: result.session,
    title: input.title,
    user: input.user,
  })
  await forkRealRuntime(result.session, forkedSession)
  const opened = await sessionService.getSession(forkedSession.id)
  if (!opened) return { ok: false as const, reason: "session_not_found" }
  return { ok: true as const, session: await buildSessionViewForUser(input.user, opened) }
}

export async function submitPromptForUser(input: {
  user: User
  requestId: string
  businessSessionId: string
  parts: z.infer<typeof inputPartSchema>[]
}) {
  const result = await requireSessionAction({
    user: input.user,
    sessionId: input.businessSessionId,
    action: "prompt",
  })
  if (!result.ok) return result
  const workspaceResult = await requireRuntimeSessionWorkspace({
    user: input.user,
    session: result.session,
  })
  if (!workspaceResult.ok) return workspaceResult
  const runtime = getRuntime(result.session.id) ?? (await openRealRuntime(workspaceResult.session))
  if (!runtime || runtime.transport !== "real") {
    return { ok: false as const, reason: "runtime_not_active" }
  }
  await renewRuntimeLeaseForSession(result.session.id)

  const liveSession = await requireLiveSession(result.session.id)
  await markSessionWaitingInput(liveSession.id)

  // 中文/English: publish the user event before prompt starts so SSE shows the turn immediately.
  const userEventTask = publishRuntimeEvent(
    createSessionEvent(liveSession, "user_message_chunk", {
      content: input.parts[0] || null,
      parts: input.parts,
    }),
  )
  const promptTask = runtime.client.prompt(withLocaleGuidance(input.parts))
  void Promise.resolve(promptTask).then(
    async (promptResult) => {
      await runtime.client.flushPendingEvents()
      const completedSession = await restoreActiveSessionIfRunning(liveSession.id)
      if (!completedSession) return
      await publishRuntimeEvent(
        createSessionEvent(completedSession, "turn_completed", {
          stopReason: promptResult?.stopReason || "unknown",
          usage: promptResult?.usage || null,
          source: "prompt",
          timestamp: new Date().toISOString(),
        }),
      )
      log.info("turn_completed published", {
        businessSessionId: liveSession.id,
        acpSessionId: runtime.client.getSessionId(),
        stopReason: promptResult?.stopReason || "unknown",
      })
    },
    async (error) => {
      await runtime.client.flushPendingEvents()
      if (isPromptAborted(error)) {
        const cancelledSession = await restoreActiveSessionIfRunning(liveSession.id)
        if (!cancelledSession) return
        await publishRuntimeEvent(
          createSessionEvent(cancelledSession, "turn_completed", {
            stopReason: "cancelled",
            usage: null,
            source: "prompt_abort",
            timestamp: new Date().toISOString(),
          }),
        )
        log.info("turn_completed published", {
          businessSessionId: liveSession.id,
          acpSessionId: runtime.client.getSessionId(),
          stopReason: "cancelled",
        })
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      const failedSession = await markSessionFailedIfRunning(liveSession.id)
      if (!failedSession) return
      await publishRuntimeEvent(
        createSessionEvent(failedSession, "session_failed", {
          message: `模型调用失败: ${message}`,
          source: "prompt",
          timestamp: new Date().toISOString(),
        }),
      )
      log.info("session_failed published", {
        businessSessionId: liveSession.id,
        acpSessionId: runtime.client.getSessionId(),
        message,
      })
    },
  )
  void userEventTask

  const auditLogTask = auditService.appendAuditLog({
    tenantId: liveSession.tenantId,
    organizationId: liveSession.organizationId,
    userId: input.user.id,
    businessSessionId: liveSession.id,
    requestId: input.requestId,
    action: "session.prompt",
    resourceType: "business_session",
    resourceId: liveSession.id,
    detail: {
      partCount: input.parts.length,
    },
  })
  // 中文/English: audit persistence must not hold the request behind the event write queue.
  void auditLogTask

  return { ok: true as const, accepted: true }
}

export async function cancelPromptForUser(input: {
  user: User
  requestId: string
  businessSessionId: string
}) {
  const result = await requireSessionAction({
    user: input.user,
    sessionId: input.businessSessionId,
    action: "cancel",
  })
  if (!result.ok) return result
  const runtime = getRuntime(result.session.id)
  if (!runtime || runtime.transport !== "real" || !runtime.client.hasActivePrompt()) {
    return { ok: false as const, reason: "runtime_not_active" }
  }
  await renewRuntimeLeaseForSession(result.session.id)
  await markSessionCancelling(result.session.id)
  await cancelRuntimePrompt(result.session.id)

  const auditLogTask = auditService.appendAuditLog({
    tenantId: result.session.tenantId,
    organizationId: result.session.organizationId,
    userId: input.user.id,
    businessSessionId: result.session.id,
    requestId: input.requestId,
    action: "session.cancel",
    resourceType: "business_session",
    resourceId: result.session.id,
    detail: {},
  })
  void auditLogTask

  return { ok: true as const, success: true }
}

export async function updateSessionModeForUser(input: {
  user: User
  businessSessionId: string
  modeId: string
}) {
  const result = await requireSessionAction({
    user: input.user,
    sessionId: input.businessSessionId,
    action: "mode_update",
  })
  if (!result.ok) return result
  const runtime = getRuntime(result.session.id)
  if (!runtime || runtime.transport !== "real") {
    return { ok: false as const, reason: "runtime_not_active" }
  }
  await renewRuntimeLeaseForSession(result.session.id)
  const response = await runtime.client.setSessionMode(input.modeId)
  const current = await sessionService.getSession(result.session.id)
  await sessionService.updateSession(result.session.id, {
    capabilityState: {
      ...current?.capabilityState,
      modeId: input.modeId,
      modes: response ? (response as Record<string, unknown>) : current?.capabilityState?.modes,
    },
  })
  return { ok: true as const, success: true }
}

export async function updateSessionModelForUser(input: {
  user: User
  businessSessionId: string
  modelId: string
}) {
  const result = await requireSessionAction({
    user: input.user,
    sessionId: input.businessSessionId,
    action: "model_update",
  })
  if (!result.ok) return result
  const runtime = getRuntime(result.session.id)
  if (!runtime || runtime.transport !== "real") {
    return { ok: false as const, reason: "runtime_not_active" }
  }
  await renewRuntimeLeaseForSession(result.session.id)
  const response = await runtime.client.setSessionModel(input.modelId)
  const current = await sessionService.getSession(result.session.id)
  await sessionService.updateSession(result.session.id, {
    capabilityState: {
      ...current?.capabilityState,
      modelId: input.modelId,
      models: response ? (response as Record<string, unknown>) : current?.capabilityState?.models,
    },
  })
  return { ok: true as const, success: true }
}

export async function updateSessionConfigForUser(input: {
  user: User
  businessSessionId: string
  configId: string
  value: string | boolean
}) {
  const result = await requireSessionAction({
    user: input.user,
    sessionId: input.businessSessionId,
    action: "config_update",
  })
  if (!result.ok) return result
  const runtime = getRuntime(result.session.id)
  if (!runtime || runtime.transport !== "real") {
    return { ok: false as const, reason: "runtime_not_active" }
  }
  await renewRuntimeLeaseForSession(result.session.id)
  const response = await runtime.client.setSessionConfigOption(input.configId, input.value)
  const current = await sessionService.getSession(result.session.id)
  await sessionService.updateSession(result.session.id, {
    capabilityState: {
      ...current?.capabilityState,
      configOptions: response.configOptions
        ? response.configOptions.map((item) => item as Record<string, unknown>)
        : current?.capabilityState?.configOptions,
    },
  })
  return { ok: true as const, success: true }
}

async function requireLiveSession(sessionId: string): Promise<BusinessSession> {
  const session = await sessionService.getSession(sessionId)
  if (!session) throw new Error(`session not found: ${sessionId}`)
  return session
}

async function restoreActiveSessionIfRunning(sessionId: string) {
  const session = await requireLiveSession(sessionId)
  if (session.status !== "waiting_input" && session.status !== "cancelling") return
  await markSessionActive(sessionId)
  return requireLiveSession(sessionId)
}

async function markSessionFailedIfRunning(sessionId: string) {
  const session = await requireLiveSession(sessionId)
  if (session.status !== "waiting_input" && session.status !== "cancelling") return
  await markSessionFailed(sessionId)
  return requireLiveSession(sessionId)
}

function isPromptAborted(error: unknown) {
  if (!(error instanceof Error)) return false
  return error.name === "MessageAbortedError" || /aborted|cancelled|canceled/i.test(error.message)
}

async function restoreSessionBindingForHistory(session: BusinessSession) {
  if (session.binding?.acpSessionId) return session
  const latestBinding = await getLatestRuntimeBinding(session.id)
  if (!latestBinding?.acpSessionId || !latestBinding.runtimeKey) return session
  return {
    ...session,
    binding: {
      acpSessionId: latestBinding.acpSessionId,
      runtimeKey: latestBinding.runtimeKey,
      openedAt: latestBinding.boundAt,
      transport: "real" as const,
    },
  }
}
