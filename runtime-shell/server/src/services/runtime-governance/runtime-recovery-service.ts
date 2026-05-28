import type { User } from "../../types"
import { getRuntime } from "../../acp-runtime-manager"
import { authorizeSystemWorkersAccess } from "../access/authorization-service"
import { markRuntimeBindingLost, getActiveRuntimeBinding, createRuntimeBinding } from "./runtime-binding-service"
import { resetSessionRuntime } from "../session/session-lifecycle-service"
import { markSessionCreated } from "../session/session-status-machine-service"
import { requireSessionAction } from "../session/session-access-service"
import { selectWorkerForNewSession } from "../scheduler/scheduler-service"
import { sessionService, workerService } from "../store/store-singleton"
import { ensureSessionWorkspaceForUser } from "../workspace/workspace-access-service"

export async function recoverSessionForUser(input: {
  user: User
  businessSessionId: string
}) {
  const sessionResult = await requireSessionAction({
    user: input.user,
    sessionId: input.businessSessionId,
    action: "open",
  })
  if (!sessionResult.ok) return sessionResult
  const workspaceResult = await ensureSessionWorkspaceForUser({
    user: input.user,
    session: sessionResult.session,
  })
  if (!workspaceResult.ok) return workspaceResult
  if (sessionResult.session.status !== "orphaned" && sessionResult.session.status !== "failed") {
    return { ok: false as const, reason: "invalid_session_status" }
  }
  await markSessionCreated(sessionResult.session.id)
  return {
    ok: true as const,
    session: (await sessionService.getSession(sessionResult.session.id)) || sessionResult.session,
  }
}

export async function rebindSessionForUser(input: {
  user: User
  businessSessionId: string
  reason: string
}) {
  const authorization = authorizeSystemWorkersAccess(input.user)
  if (!authorization.ok) return { ok: false as const, reason: "forbidden" }
  const session = await sessionService.getSession(input.businessSessionId)
  if (!session) return { ok: false as const, reason: "session_not_found" }
  if (session.status !== "orphaned" && session.status !== "failed" && session.status !== "created") {
    return { ok: false as const, reason: "invalid_session_status" }
  }

  // 中文/English: rebind should keep the original tenant/org scheduling scope
  // instead of accidentally selecting from the admin operator's scope.
  const worker = await selectWorkerForNewSession({
    ...input.user,
    tenantId: session.tenantId,
    organizationId: session.organizationId,
  })
  if (!worker) return { ok: false as const, reason: "worker_not_found" }

  const existingBinding = await getActiveRuntimeBinding(session.id)
  if (existingBinding) {
    await markRuntimeBindingLost(session.id)
  }

  await sessionService.updateSession(session.id, {
    workerId: worker.id,
  })
  const binding = await createRuntimeBinding({
    businessSessionId: session.id,
    workerId: worker.id,
  })
  await markSessionCreated(session.id)

  return {
    ok: true as const,
    session: (await sessionService.getSession(session.id)) || session,
    binding,
    reason: input.reason,
  }
}

export async function cleanupRuntimeGovernanceForUser(user: User) {
  const authorization = authorizeSystemWorkersAccess(user)
  if (!authorization.ok) return { ok: false as const, reason: "forbidden" }

  const sessions = await sessionService.listSessions()
  const offlineWorkers = await workerService.listWorkersByStatus(["offline", "draining"])
  const offlineWorkerIds = new Set(offlineWorkers.map((worker) => worker.id))
  const cleanedSessionIds: string[] = []

  for (const session of sessions) {
    const binding = await getActiveRuntimeBinding(session.id)
    const runtime = getRuntime(session.id)
    const isRuntimeStatus =
      session.status === "opening" ||
      session.status === "active" ||
      session.status === "waiting_input" ||
      session.status === "cancelling" ||
      session.status === "closing"

    if (!binding) {
      if (!isRuntimeStatus) continue
      await resetSessionRuntime(session.id, "created")
      cleanedSessionIds.push(session.id)
      continue
    }

    if (session.status === "opening" && !runtime) {
      await markRuntimeBindingLost(session.id)
      await resetSessionRuntime(session.id, "created")
      cleanedSessionIds.push(session.id)
      continue
    }

    const shouldCleanup =
      session.status === "orphaned" ||
      session.status === "failed" ||
      offlineWorkerIds.has(binding.workerId)

    if (!shouldCleanup) continue
    await markRuntimeBindingLost(session.id)
    cleanedSessionIds.push(session.id)
  }

  return {
    ok: true as const,
    cleanedSessionIds,
  }
}
