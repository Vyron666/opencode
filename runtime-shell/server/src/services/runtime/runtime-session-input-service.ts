import { cancelRuntimePrompt, getRuntime, openRealRuntime, publishRuntimeEvent } from "../../acp-runtime-manager"
import type { inputPartSchema } from "../../http/schemas"
import { createLogger } from "../../log"
import type { User } from "../../types"
import { requireRuntimeSessionWorkspace } from "../workspace/workspace-access-service"
import { requireSessionAction } from "../session/session-access-service"
import { createSessionEvent } from "../session/session-event-service"
import { markSessionCancelling, markSessionWaitingInput } from "../session/session-status-machine-service"
import { renewRuntimeLeaseForSession } from "../runtime-governance/runtime-lease-service"
import { auditService } from "../store/store-singleton"
import { withLocaleGuidance } from "./runtime-input-service"
import {
  isPromptAborted,
  markSessionFailedIfRunning,
  requireLiveSession,
  restoreActiveSessionIfRunning,
} from "./runtime-session-support"
import type { z } from "zod"

const log = createLogger("runtime-service")

export async function submitPromptForUser(input: {
  user: User
  requestId: string
  businessSessionId: string
  parts: z.infer<typeof inputPartSchema>[]
}) {
  const requestStartedAt = Date.now()
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
  const hadLiveRuntime = Boolean(getRuntime(result.session.id))
  const runtime = getRuntime(result.session.id) ?? (await openRealRuntime(workspaceResult.session))
  if (!runtime || runtime.transport !== "real") {
    return { ok: false as const, reason: "runtime_not_active" }
  }
  await renewRuntimeLeaseForSession(result.session.id)

  const liveSession = await requireLiveSession(result.session.id)
  await markSessionWaitingInput(liveSession.id)
  const userEventCreatedAt = Date.now()

  // 中文/English: publish the user event before prompt starts so SSE shows the turn immediately.
  const userEventTask = publishRuntimeEvent(
    createSessionEvent(liveSession, "user_message_chunk", {
      content: input.parts[0] || null,
      parts: input.parts,
    }),
  )
  log.info("prompt dispatch starting", {
    requestId: input.requestId,
    businessSessionId: liveSession.id,
    acpSessionId: runtime.client.getSessionId(),
    workerId: liveSession.workerId,
    hadLiveRuntime,
    requestToDispatchMs: Date.now() - requestStartedAt,
    dispatchToUserEventMs: userEventCreatedAt - requestStartedAt,
  })
  const promptTask = runtime.client.prompt(withLocaleGuidance(input.parts))
  void Promise.resolve(promptTask).then(
    async (promptResult) => {
      log.info("prompt call resolved", {
        requestId: input.requestId,
        businessSessionId: liveSession.id,
        acpSessionId: runtime.client.getSessionId(),
        workerId: liveSession.workerId,
        requestToResolvedMs: Date.now() - requestStartedAt,
      })
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
      log.warn("prompt call rejected", {
        requestId: input.requestId,
        businessSessionId: liveSession.id,
        acpSessionId: runtime.client.getSessionId(),
        workerId: liveSession.workerId,
        requestToRejectedMs: Date.now() - requestStartedAt,
        message: error instanceof Error ? error.message : String(error),
      })
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
