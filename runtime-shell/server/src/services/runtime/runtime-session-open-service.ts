import { forkRealRuntime, loadRealRuntime, resumeRealRuntime } from "../../acp-runtime-manager"
import type { User } from "../../types"
import { requireQuotaForRuntimeOperation, requireQuotaForSessionCreate } from "../sandbox/sandbox-quota-service"
import { markRuntimeOperationCompleted, markRuntimeOperationFailed, markRuntimeOperationRunning, startRuntimeOperation } from "../sandbox/sandbox-queue-service"
import { requireSessionAction } from "../session/session-access-service"
import { buildSessionViewForUser } from "../session/session-summary-service"
import { sessionService } from "../store/store-singleton"
import { requireRuntimeSessionWorkspace } from "../workspace/workspace-access-service"
import { restoreSessionBindingForHistory } from "./runtime-session-support"

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
  const queued = await runRuntimeOperationWithQuota({
    user: input.user,
    projectId: workspaceResult.session.projectId,
    businessSessionId: workspaceResult.session.id,
    workerId: workspaceResult.session.workerId || undefined,
    operationType: "session_load",
    run: () => loadRealRuntime(workspaceResult.session),
  })
  if ("ok" in queued && !queued.ok) return queued
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
  const queued = await runRuntimeOperationWithQuota({
    user: input.user,
    projectId: workspaceResult.session.projectId,
    businessSessionId: workspaceResult.session.id,
    workerId: workspaceResult.session.workerId || undefined,
    operationType: "session_resume",
    run: () => resumeRealRuntime(workspaceResult.session),
  })
  if ("ok" in queued && !queued.ok) return queued
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
  const sessionQuota = await requireQuotaForSessionCreate({
    user: input.user,
    projectId: result.session.projectId,
  })
  if (!sessionQuota.ok) return { ok: false as const, reason: sessionQuota.reason }
  const runtimeQuota = await requireQuotaForRuntimeOperation({
    user: input.user,
    projectId: result.session.projectId,
  })
  if (!runtimeQuota.ok) return { ok: false as const, reason: runtimeQuota.reason }
  const forkedSession = await sessionService.forkSession({
    source: result.session,
    title: input.title,
    user: input.user,
  })
  await runRuntimeOperationWithoutQuota({
    user: input.user,
    projectId: forkedSession.projectId,
    businessSessionId: forkedSession.id,
    workerId: forkedSession.workerId || undefined,
    operationType: "session_fork",
    detail: {
      sourceBusinessSessionId: result.session.id,
    },
    run: () => forkRealRuntime(result.session, forkedSession),
  })
  const opened = await sessionService.getSession(forkedSession.id)
  if (!opened) return { ok: false as const, reason: "session_not_found" }
  return { ok: true as const, session: await buildSessionViewForUser(input.user, opened) }
}

async function runRuntimeOperationWithQuota<T>(input: {
  user: User
  projectId: string
  businessSessionId?: string
  workerId?: string
  operationType: "session_load" | "session_resume"
  run: () => Promise<T>
}) {
  const quota = await requireQuotaForRuntimeOperation({
    user: input.user,
    projectId: input.projectId,
    businessSessionId: input.businessSessionId,
  })
  if (!quota.ok) return { ok: false as const, reason: quota.reason }
  return runRuntimeOperationWithoutQuota(input)
}

async function runRuntimeOperationWithoutQuota<T>(input: {
  user: User
  projectId: string
  businessSessionId?: string
  workerId?: string
  operationType: "session_load" | "session_resume" | "session_fork"
  detail?: Record<string, unknown>
  run: () => Promise<T>
}) {
  const operation = await startRuntimeOperation({
    user: input.user,
    projectId: input.projectId,
    businessSessionId: input.businessSessionId,
    workerId: input.workerId,
    operationType: input.operationType,
    detail: input.detail,
  })
  try {
    await markRuntimeOperationRunning(operation.id, input.workerId)
    const result = await input.run()
    await markRuntimeOperationCompleted(operation.id)
    return result
  } catch (error) {
    await markRuntimeOperationFailed(operation.id, error instanceof Error ? error.message : String(error))
    throw error
  }
}
