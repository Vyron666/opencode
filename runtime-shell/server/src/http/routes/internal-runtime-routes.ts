import type { Hono } from "hono"
import { Config, findLocalWorkerConfig } from "../../config"
import { jsonError, jsonOk, requestId } from "../response"
import type { PendingPermission, PendingQuestion, SessionEvent } from "../../types"
import { persistAndFanout } from "../../runtime/runtime-events"
import {
  addPendingPermission,
  addPendingQuestion,
  clearPendingPermissionsBySession,
  clearPendingQuestionsBySession,
  consumeClosingSession,
  deletePendingPermission,
  deletePendingQuestion,
  deleteRuntime,
} from "../../runtime/runtime-registry"
import { stopRuntimeLeaseAutoRenew } from "../../services/runtime-governance/runtime-lease-renewal-service"
import { resetSessionRuntime } from "../../services/session/session-lifecycle-service"
import { recordRuntimeFailure } from "../../services/runtime-governance/runtime-failure-service"

type RuntimeEventPushBody = {
  event: SessionEvent
  pendingPermission?: PendingPermission
  pendingQuestion?: PendingQuestion
  testAutoResolve?: {
    question?: {
      action: "accept" | "decline" | "cancel"
      content?: Record<string, unknown>
    }
    permission?: {
      approved: boolean
      optionId?: string
    }
  }
}

export function registerInternalRuntimeRoutes(app: Hono) {
  app.get("/api/internal/runtime/healthz", async (c) => {
    if (!isWorkerAgentAuthorized(c.req.header("x-runtime-worker-token"))) {
      return c.json(jsonError("unauthorized", 401, requestId(c)), 401)
    }
    return c.json(jsonOk({ success: true }, requestId(c)))
  })

  app.post("/api/internal/runtime/event-push", async (c) => {
    const reqId = requestId(c)
    if (!isWorkerAgentAuthorized(c.req.header("x-runtime-worker-token"))) {
      return c.json(jsonError("unauthorized", 401, reqId), 401)
    }
    const body = await c.req.json() as RuntimeEventPushBody
    if (!body?.event?.businessSessionId || !body.event.workerId || !body.event.eventType) {
      return c.json(jsonError("invalid runtime event payload", 400, reqId), 400)
    }

    if (body.pendingPermission) {
      addPendingPermission(body.pendingPermission, {
        resolve: async ({ approved, optionId }) => {
          if (body.testAutoResolve?.permission) {
            deletePendingPermission(body.pendingPermission!.requestId)
            await persistAndFanout({
              eventId: `evt_${crypto.randomUUID().replace(/-/g, "")}`,
              eventType: "permission_resolved",
              businessSessionId: body.event.businessSessionId,
              acpSessionId: body.event.acpSessionId,
              workerId: body.event.workerId,
              timestamp: new Date().toISOString(),
              payload: {
                requestId: body.pendingPermission!.requestId,
                outcome: approved
                  ? {
                      outcome: "selected",
                      optionId: optionId || null,
                    }
                  : {
                      outcome: "cancelled",
                    },
                optionKind: approved ? optionId || "allow" : "reject",
              },
            })
            return true
          }
          const ok = await resolveRemotePermission(body.event.workerId, body.pendingPermission!.requestId, approved, optionId)
            .catch(() => false)
          if (!ok) return false
          deletePendingPermission(body.pendingPermission!.requestId)
          return true
        },
      })
    }

    if (body.pendingQuestion) {
      addPendingQuestion(body.pendingQuestion, {
        resolve: async (input) => {
          if (body.testAutoResolve?.question) {
            deletePendingQuestion(body.pendingQuestion!.requestId)
            await persistAndFanout({
              eventId: `evt_${crypto.randomUUID().replace(/-/g, "")}`,
              eventType: "question_resolved",
              businessSessionId: body.event.businessSessionId,
              acpSessionId: body.event.acpSessionId,
              workerId: body.event.workerId,
              timestamp: new Date().toISOString(),
              payload: {
                requestId: body.pendingQuestion!.requestId,
                action: input.action,
                ...(input.action === "accept" ? { content: input.content || {} } : {}),
              },
            })
            return true
          }
          const ok = await resolveRemoteQuestion(body.event.workerId, body.pendingQuestion!.requestId, input)
            .catch(() => false)
          if (!ok) return false
          deletePendingQuestion(body.pendingQuestion!.requestId)
          return true
        },
      })
    }

    if (body.event.eventType === "worker_disconnected") {
      stopRuntimeLeaseAutoRenew(body.event.businessSessionId)
      deleteRuntime(body.event.businessSessionId)
      clearPendingPermissionsBySession(body.event.businessSessionId)
      clearPendingQuestionsBySession(body.event.businessSessionId)
      if (consumeClosingSession(body.event.businessSessionId)) {
        return c.json(jsonOk({ success: true }, reqId))
      }
      await resetSessionRuntime(body.event.businessSessionId, "orphaned")
      await recordRuntimeFailure({
        businessSessionId: body.event.businessSessionId,
        workerId: body.event.workerId,
        failureType: "runtime_exit",
        message: typeof body.event.payload.message === "string" ? body.event.payload.message : "ACP runtime exited unexpectedly",
        detail: {
          code: body.event.payload.code,
          signal: body.event.payload.signal,
          remote: true,
        },
      })
    }

    await persistAndFanout(body.event)
    return c.json(jsonOk({ success: true }, reqId))
  })
}

function isWorkerAgentAuthorized(token: string | undefined) {
  return Boolean(token) && token === Config.workerAgentToken
}

async function resolveRemotePermission(workerId: string, requestId: string, approved: boolean, optionId?: string) {
  const worker = findLocalWorkerConfig(workerId)
  if (!worker?.agentBaseUrl) return false
  const response = await fetch(`${worker.agentBaseUrl}/runtime/resolve-permission`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-runtime-worker-token": Config.workerAgentToken,
    },
    body: JSON.stringify({
      requestId,
      approved,
      optionId,
    }),
  })
  return response.ok
}

async function resolveRemoteQuestion(
  workerId: string,
  requestId: string,
  input: { action: "accept" | "decline" | "cancel"; content?: Record<string, unknown> },
) {
  const worker = findLocalWorkerConfig(workerId)
  if (!worker?.agentBaseUrl) return false
  const response = await fetch(`${worker.agentBaseUrl}/runtime/resolve-question`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-runtime-worker-token": Config.workerAgentToken,
    },
    body: JSON.stringify({
      requestId,
      action: input.action,
      content: input.content,
    }),
  })
  return response.ok
}
