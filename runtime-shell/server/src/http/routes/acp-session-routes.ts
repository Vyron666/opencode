import type { Hono } from "hono"
import {
  cancelRuntimePrompt,
  forkRealRuntime,
  getRuntime,
  loadRealRuntime,
  openRealRuntime,
  publishRuntimeEvent,
  resumeRealRuntime,
} from "../../acp-runtime-manager"
import { store } from "../../store"
import { createLogger } from "../../log"
import {
  configSchema,
  forkSessionSchema,
  inputSchema,
  modeSchema,
  modelSchema,
  sessionIdSchema,
} from "../schemas"
import { jsonError, jsonOk, requestId } from "../response"
import { requireUser, unauthorized } from "../auth-helpers"
import { createSessionEvent, requireBusinessSession, sessionSummary, withLocaleGuidance } from "../session-helpers"

const log = createLogger("http")

export function registerAcpSessionRoutes(app: Hono) {
  app.post("/api/acp/session/load", async (c) => {
    const reqId = requestId(c)
    const user = requireUser(c)
    if (!user) return unauthorized(c)
    const body = sessionIdSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid load payload", 400, reqId, body.error.flatten()), 400)
    }
    const result = requireBusinessSession(c, body.data.businessSessionId, user)
    if ("response" in result) return result.response
    await loadRealRuntime(result.session)
    const loaded = store.getSession(result.session.id)
    if (!loaded) return c.json(jsonError("session not found", 404, reqId), 404)
    return c.json(jsonOk(sessionSummary(loaded), reqId))
  })

  app.post("/api/acp/session/resume", async (c) => {
    const reqId = requestId(c)
    const user = requireUser(c)
    if (!user) return unauthorized(c)
    const body = sessionIdSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid resume payload", 400, reqId, body.error.flatten()), 400)
    }
    const result = requireBusinessSession(c, body.data.businessSessionId, user)
    if ("response" in result) return result.response
    await resumeRealRuntime(result.session)
    const resumed = store.getSession(result.session.id)
    if (!resumed) return c.json(jsonError("session not found", 404, reqId), 404)
    return c.json(jsonOk(sessionSummary(resumed), reqId))
  })

  app.post("/api/acp/session/fork", async (c) => {
    const reqId = requestId(c)
    const user = requireUser(c)
    if (!user) return unauthorized(c)
    const body = forkSessionSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid fork payload", 400, reqId, body.error.flatten()), 400)
    }
    const result = requireBusinessSession(c, body.data.businessSessionId, user)
    if ("response" in result) return result.response
    const forkedSession = await store.forkSession({
      source: result.session,
      title: body.data.title,
      user,
    })
    await forkRealRuntime(result.session, forkedSession)
    const opened = store.getSession(forkedSession.id)
    if (!opened) return c.json(jsonError("session not found", 404, reqId), 404)
    return c.json(jsonOk(sessionSummary(opened), reqId))
  })

  app.post("/api/acp/session/input", async (c) => {
    const reqId = requestId(c)
    const user = requireUser(c)
    if (!user) return unauthorized(c)
    const body = inputSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid input payload", 400, reqId, body.error.flatten()), 400)
    }
    const result = requireBusinessSession(c, body.data.businessSessionId, user)
    if ("response" in result) return result.response
    const runtime = getRuntime(result.session.id) ?? (await openRealRuntime(result.session))
    if (!runtime || runtime.transport !== "real") {
      return c.json(jsonError("session runtime is not active", 409, reqId), 409)
    }
    ////////////// runtime-shell customization start //////////////
    // 中文/English: publish the user event immediately so SSE sees it first,
    // but do not wait for the slow persistence queue before starting `prompt()`.
    const userEventTask = publishRuntimeEvent(
      createSessionEvent(result.session, "user_message_chunk", {
        content: body.data.parts[0] || null,
        parts: body.data.parts,
      }),
    )
    const promptTask = runtime.client.prompt(withLocaleGuidance(body.data.parts))
    void Promise.resolve(promptTask).then(
      async (promptResult) => {
        ////////////// runtime-shell customization start //////////////
        // 中文/English: wait for every upstream chunk from this turn to flush
        // before publishing the completion event to the frontend.
        await runtime.client.flushPendingEvents()
        ////////////// runtime-shell customization end //////////////
        await publishRuntimeEvent(
          createSessionEvent(result.session, "turn_completed", {
            stopReason: promptResult?.stopReason || "unknown",
            usage: promptResult?.usage || null,
            source: "prompt",
            timestamp: new Date().toISOString(),
          }),
        )
        ////////////// runtime-shell customization start //////////////
        // 中文/English: this is the real turn-end event published to SSE/frontend.
        log.info("turn_completed published", {
          businessSessionId: result.session.id,
          acpSessionId: runtime.client.getSessionId(),
          stopReason: promptResult?.stopReason || "unknown",
        })
        ////////////// runtime-shell customization end //////////////
      },
      async (error) => {
        ////////////// runtime-shell customization start //////////////
        // 中文/English: always flush upstream events first, no matter whether
        // the turn ends normally, is cancelled, or fails.
        await runtime.client.flushPendingEvents()
        ////////////// runtime-shell customization end //////////////
        if (isPromptAborted(error)) {
          await publishRuntimeEvent(
            createSessionEvent(result.session, "turn_completed", {
              stopReason: "cancelled",
              usage: null,
              source: "prompt_abort",
              timestamp: new Date().toISOString(),
            }),
          )
          ////////////// runtime-shell customization start //////////////
          // 中文/English: cancellation still ends the turn through the same frontend stop event.
          log.info("turn_completed published", {
            businessSessionId: result.session.id,
            acpSessionId: runtime.client.getSessionId(),
            stopReason: "cancelled",
          })
          ////////////// runtime-shell customization end //////////////
          return
        }
        const message = error instanceof Error ? error.message : String(error)
        await publishRuntimeEvent(
          createSessionEvent(result.session, "session_failed", {
            message: `模型调用失败: ${message}`,
            source: "prompt",
            timestamp: new Date().toISOString(),
          }),
        )
        ////////////// runtime-shell customization start //////////////
        // 中文/English: failures stop the frontend only when this runtime event is published.
        log.info("session_failed published", {
          businessSessionId: result.session.id,
          acpSessionId: runtime.client.getSessionId(),
          message,
        })
        ////////////// runtime-shell customization end //////////////
      },
    )
    ////////////// runtime-shell customization start //////////////
    // 中文/English: do not block the HTTP response on local event persistence.
    // The frontend should leave "发送中" as soon as runtime-shell accepts the turn,
    // while event durability continues on the store write queue in the background.
    void userEventTask
    ////////////// runtime-shell customization end //////////////
    const auditLogTask = store.appendAuditLog({
      tenantId: result.session.tenantId,
      organizationId: result.session.organizationId,
      userId: user.id,
      businessSessionId: result.session.id,
      requestId: reqId,
      action: "session.prompt",
      resourceType: "business_session",
      resourceId: result.session.id,
      detail: {
        partCount: body.data.parts.length,
      },
    })
    // 中文/English: audit persistence must still happen, but it must not hold
    // the request open behind the same write queue as upstream chunks.
    void auditLogTask
    return c.json(jsonOk({ accepted: true }, reqId))
  })

  app.post("/api/acp/session/cancel", async (c) => {
    const reqId = requestId(c)
    const user = requireUser(c)
    if (!user) return unauthorized(c)
    const body = sessionIdSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid cancel payload", 400, reqId, body.error.flatten()), 400)
    }
    const result = requireBusinessSession(c, body.data.businessSessionId, user)
    if ("response" in result) return result.response
    const success = await cancelRuntimePrompt(result.session.id)
    if (!success) {
      return c.json(jsonError("session runtime is not active", 409, reqId), 409)
    }
    const auditLogTask = store.appendAuditLog({
      tenantId: result.session.tenantId,
      organizationId: result.session.organizationId,
      userId: user.id,
      businessSessionId: result.session.id,
      requestId: reqId,
      action: "session.cancel",
      resourceType: "business_session",
      resourceId: result.session.id,
      detail: {},
    })
    ////////////// runtime-shell customization start //////////////
    // 中文/English: cancellation feedback should return immediately so the UI
    // can switch to "取消中" without waiting on audit persistence.
    void auditLogTask
    ////////////// runtime-shell customization end //////////////
    return c.json(jsonOk({ success: true }, reqId))
  })

  app.post("/api/acp/session/mode/update", async (c) => {
    const reqId = requestId(c)
    const user = requireUser(c)
    if (!user) return unauthorized(c)
    const body = modeSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid mode payload", 400, reqId, body.error.flatten()), 400)
    }
    const result = requireBusinessSession(c, body.data.businessSessionId, user)
    if ("response" in result) return result.response
    const runtime = getRuntime(result.session.id)
    if (!runtime || runtime.transport !== "real") {
      return c.json(jsonError("session runtime is not active", 409, reqId), 409)
    }
    const response = await runtime.client.setSessionMode(body.data.modeId)
    const current = store.getSession(result.session.id)
    await store.updateSession(result.session.id, {
      capabilityState: {
        ...current?.capabilityState,
        modeId: body.data.modeId,
        modes: response ? (response as Record<string, unknown>) : current?.capabilityState?.modes,
      },
    })
    return c.json(jsonOk({ success: true }, reqId))
  })

  app.post("/api/acp/session/model/update", async (c) => {
    const reqId = requestId(c)
    const user = requireUser(c)
    if (!user) return unauthorized(c)
    const body = modelSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid model payload", 400, reqId, body.error.flatten()), 400)
    }
    const result = requireBusinessSession(c, body.data.businessSessionId, user)
    if ("response" in result) return result.response
    const runtime = getRuntime(result.session.id)
    if (!runtime || runtime.transport !== "real") {
      return c.json(jsonError("session runtime is not active", 409, reqId), 409)
    }
    const response = await runtime.client.setSessionModel(body.data.modelId)
    const current = store.getSession(result.session.id)
    await store.updateSession(result.session.id, {
      capabilityState: {
        ...current?.capabilityState,
        modelId: body.data.modelId,
        models: response ? (response as Record<string, unknown>) : current?.capabilityState?.models,
      },
    })
    return c.json(jsonOk({ success: true }, reqId))
  })

  app.post("/api/acp/session/config/update", async (c) => {
    const reqId = requestId(c)
    const user = requireUser(c)
    if (!user) return unauthorized(c)
    const body = configSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid config payload", 400, reqId, body.error.flatten()), 400)
    }
    const result = requireBusinessSession(c, body.data.businessSessionId, user)
    if ("response" in result) return result.response
    const runtime = getRuntime(result.session.id)
    if (!runtime || runtime.transport !== "real") {
      return c.json(jsonError("session runtime is not active", 409, reqId), 409)
    }
    const response = await runtime.client.setSessionConfigOption(body.data.configId, body.data.value)
    const current = store.getSession(result.session.id)
    await store.updateSession(result.session.id, {
      capabilityState: {
        ...current?.capabilityState,
        configOptions: response.configOptions
          ? response.configOptions.map((item) => item as Record<string, unknown>)
          : current?.capabilityState?.configOptions,
      },
    })
    return c.json(jsonOk({ success: true }, reqId))
  })
}

function isPromptAborted(error: unknown) {
  if (!(error instanceof Error)) return false
  return error.name === "MessageAbortedError" || /aborted|cancelled|canceled/i.test(error.message)
}
