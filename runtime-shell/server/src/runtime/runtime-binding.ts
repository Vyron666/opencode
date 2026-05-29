import type { CreateElicitationResponse } from "@agentclientprotocol/sdk"
import { AcpProcessClient } from "../acp/acp-process-client"
import { getCustomModels } from "../config"
import { createLogger } from "../log"
import { recordRuntimeFailure } from "../services/runtime-governance/runtime-failure-service"
import { startRuntimeLeaseAutoRenew, stopRuntimeLeaseAutoRenew } from "../services/runtime-governance/runtime-lease-renewal-service"
import type { BusinessSession } from "../types"
import { activateSessionRuntime, resetSessionRuntime } from "../services/session/session-lifecycle-service"
import { extractUpstreamError, normalizeBootstrap } from "./runtime-capabilities"
import { createEvent, persistAndFanout, nextId } from "./runtime-events"
import {
  addPendingPermission,
  addPendingQuestion,
  clearPendingPermissionsBySession,
  clearPendingQuestionsBySession,
  consumeClosingSession,
  deletePendingPermission,
  deletePendingQuestion,
  deleteRuntime,
  setRuntime,
} from "./runtime-registry"
import type { RuntimeEntry, SessionBootstrap } from "./runtime-types"

const log = createLogger("runtime")
const UPSTREAM_QUIET_WINDOW_MS = 120

export async function bindRuntime(
  session: BusinessSession,
  client: AcpProcessClient,
  response: SessionBootstrap,
  kind: "opened" | "loaded" | "resumed" | "forked",
) {
  const customModels = await getCustomModels()
  if (customModels.length) {
    log.info("custom models loaded", {
      count: customModels.length,
      models: customModels.map((model) => model.modelId),
    })
  }

  const updated = await activateSessionRuntime({
    sessionId: session.id,
    binding: {
      acpSessionId: response.sessionId,
      runtimeKey: nextId("runtime"),
      openedAt: new Date().toISOString(),
      transport: "real",
    },
    capabilityState: {
      ...session.capabilityState,
      ...(await normalizeBootstrap(session, response)),
    },
  })
  if (!updated) {
    await client.close()
    throw new Error("failed to bind session")
  }

  const runtime: RuntimeEntry = { client, transport: "real" }
  setRuntime(session.id, runtime)
  startRuntimeLeaseAutoRenew(session.id)
  client.onExit((code, signal) => {
    stopRuntimeLeaseAutoRenew(session.id)
    deleteRuntime(session.id)
    clearPendingPermissionsBySession(session.id)
    clearPendingQuestionsBySession(session.id)
    if (consumeClosingSession(session.id)) return
    void Promise.resolve()
      // 中文/English: unexpected worker exit marks the session orphaned and clears
      // the runtime binding so later reopen starts from a clean runtime boundary.
      .then(() => resetSessionRuntime(session.id, "orphaned"))
      .then(() =>
        recordRuntimeFailure({
          businessSessionId: session.id,
          workerId: session.workerId,
          failureType: "runtime_exit",
          message: "ACP runtime exited unexpectedly",
          detail: { code, signal },
        }),
      )
      .then(() =>
        persistAndFanout(
          createEvent(
            updated,
            "worker_disconnected",
            {
              code,
              signal,
              message: "ACP runtime exited unexpectedly",
            },
            response.sessionId,
          ),
        ),
      )
  })

  client.onPermissionRequested((permission) => {
    addPendingPermission(permission, {
      resolve: ({ approved, optionId }) => {
        const ok = approved && optionId
          ? client.resolvePermission(permission.requestId, optionId)
          : client.rejectPermission(permission.requestId)
        if (!ok) return
        deletePendingPermission(permission.requestId)
      },
    })
  })

  client.onQuestionRequested((question) => {
    addPendingQuestion(question, {
      resolve: (res) => {
        const response: CreateElicitationResponse =
          res.action === "accept"
            ? { action: "accept", content: res.content ?? {} }
            : res.action === "decline"
              ? { action: "decline" }
              : { action: "cancel" }
        const ok = client.resolveQuestion(question.requestId, response)
        if (!ok) return
        deletePendingQuestion(question.requestId)
      },
    })
  })

  await persistAndFanout(
    createEvent(
      updated,
      "session_opened",
      {
        transport: "real",
        phase: kind,
        models: response.models ?? null,
        modes: response.modes ?? null,
        configOptions: response.configOptions ?? [],
      },
      response.sessionId,
    ),
  )
  return runtime
}

export function createClient(session: BusinessSession) {
  let upstreamEventVersion = 0
  let lastUpstreamEventAt = 0

  const waitForUpstreamQuiet = async () => {
    let observedVersion = -1

    while (true) {
      const quietForMs = lastUpstreamEventAt ? Date.now() - lastUpstreamEventAt : Number.POSITIVE_INFINITY
      if (observedVersion === upstreamEventVersion && quietForMs >= UPSTREAM_QUIET_WINDOW_MS) return
      observedVersion = upstreamEventVersion
      const waitMs = Math.max(UPSTREAM_QUIET_WINDOW_MS - quietForMs, 0)
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs))
      }
    }
  }

  return new AcpProcessClient(
    {
      cwd: session.workspacePath,
      businessSessionId: session.id,
      workerId: session.workerId,
      onEvent: (event) => {
        upstreamEventVersion += 1
        lastUpstreamEventAt = Date.now()
        ////////////// runtime-shell customization start //////////////
        // 中文/English: publish and stage each upstream chunk immediately so SSE
        // does not wait for the previous event's disk write before seeing the next chunk.
        // `flushPendingEvents()` still waits for the full persistence queue later.
        const upstreamError =
          event.eventType === "session_info_update"
            ? extractUpstreamError(event.payload)
            : undefined
        const nextWrite = persistAndFanout(
          upstreamError
            ? {
                ...event,
                eventType: "session_error",
                payload: { error: upstreamError },
              }
            : event,
        )
        void nextWrite
        return
        ////////////// runtime-shell customization end //////////////
      },
    },
    () => {
      ////////////// runtime-shell customization start //////////////
      // 中文/English: wait for the persisted queue first, then require one
      // quiet window so prompt completion does not outrun late upstream chunks.
      return waitForUpstreamQuiet()
      ////////////// runtime-shell customization end //////////////
    },
  )
}
