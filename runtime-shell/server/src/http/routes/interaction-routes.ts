import type { Hono } from "hono"
import {
  listPendingPermissions,
  listPendingQuestions,
  resolvePendingPermission,
  resolvePendingQuestion,
  subscribeRuntimeEvents,
} from "../../acp-runtime-manager"
import { store } from "../../store"
import { permissionResponseSchema, questionResponseSchema } from "../schemas"
import { jsonError, jsonOk, requestId } from "../response"
import { requireUser, unauthorized } from "../auth-helpers"
import { requireBusinessSession } from "../session-helpers"
import type { SessionEvent } from "../../types"

export function registerInteractionRoutes(app: Hono) {
  app.get("/api/acp/session/permission/list", (c) => {
    const reqId = requestId(c)
    const user = requireUser(c)
    if (!user) return unauthorized(c)
    const sessionId = c.req.query("businessSessionId") || undefined
    return c.json(jsonOk({ items: listPendingPermissions(sessionId) }, reqId))
  })

  app.get("/api/acp/session/question/list", (c) => {
    const reqId = requestId(c)
    const user = requireUser(c)
    if (!user) return unauthorized(c)
    const sessionId = c.req.query("businessSessionId") || undefined
    return c.json(jsonOk({ items: listPendingQuestions(sessionId) }, reqId))
  })

  app.post("/api/acp/session/permission/respond", async (c) => {
    const reqId = requestId(c)
    const user = requireUser(c)
    if (!user) return unauthorized(c)
    const body = permissionResponseSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid permission payload", 400, reqId, body.error.flatten()), 400)
    }
    const result = requireBusinessSession(c, body.data.businessSessionId, user)
    if ("response" in result) return result.response
    const success = resolvePendingPermission(body.data.requestId, {
      approved: body.data.approved,
      optionId: body.data.optionId,
    })
    if (!success) {
      return c.json(jsonError("permission request not found", 404, reqId), 404)
    }
    return c.json(jsonOk({ success: true }, reqId))
  })

  app.post("/api/acp/session/question/respond", async (c) => {
    const reqId = requestId(c)
    const user = requireUser(c)
    if (!user) return unauthorized(c)
    const body = questionResponseSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid question payload", 400, reqId, body.error.flatten()), 400)
    }
    const result = requireBusinessSession(c, body.data.businessSessionId, user)
    if ("response" in result) return result.response
    const success = resolvePendingQuestion(body.data.requestId, {
      action: body.data.action,
      content: body.data.content as Record<string, unknown> | undefined,
    })
    if (!success) {
      return c.json(jsonError("question request not found", 404, reqId), 404)
    }
    return c.json(jsonOk({ success: true }, reqId))
  })

  app.get("/api/acp/session/events", async (c) => {
    const reqId = requestId(c)
    const user = requireUser(c)
    if (!user) return unauthorized(c)
    const sessionId = c.req.query("businessSessionId")
    if (!sessionId) return c.json(jsonError("businessSessionId is required", 400, reqId), 400)
    const result = requireBusinessSession(c, sessionId, user)
    if ("response" in result) return result.response
    const afterEventId =
      c.req.query("afterEventId") || c.req.header("last-event-id") || c.req.header("Last-Event-ID") || undefined
    const encoder = new TextEncoder()

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false
        let replayingHistory = true
        const seenEventIds = new Set<string>()
        const queuedEvents: SessionEvent[] = []

        // 中文/English: subscribe first, then replay history, so no event is lost
        // between persisted replay and live subscriber registration.
        const cleanupRuntime = subscribeRuntimeEvents(result.session.id, (event) => {
          if (replayingHistory) {
            queuedEvents.push(event)
            return
          }
          write(event)
        })

        // 中文/English: emit `id:` for business events so clients can resume without losing messages.
        const write = (payload: unknown) => {
          if (closed) return
          if (
            payload &&
            typeof payload === "object" &&
            typeof (payload as SessionEvent).eventId === "string" &&
            typeof (payload as SessionEvent).eventType === "string"
          ) {
            const event = payload as SessionEvent
            if (seenEventIds.has(event.eventId)) return
            seenEventIds.add(event.eventId)
            controller.enqueue(encoder.encode(`id: ${event.eventId}\n`))
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
            return
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
        }

        store.listEvents(result.session.id, afterEventId).forEach(write)
        replayingHistory = false
        queuedEvents.forEach(write)
        write({ type: "heartbeat", sessionId: result.session.id })

        // 中文/English: keep connection active within Bun's default idle timeout window.
        const timer = setInterval(() => write({ type: "heartbeat", sessionId: result.session.id }), 5000)

        c.req.raw.signal.addEventListener("abort", () => {
          if (closed) return
          closed = true
          clearInterval(timer)
          cleanupRuntime()
          controller.close()
        })
      },
    })

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    })
  })
}
