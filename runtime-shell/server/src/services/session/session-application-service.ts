import { closeRuntime } from "../../acp-runtime-manager"
import { waitForSessionEventWrites } from "../../runtime/runtime-events"
import type { User } from "../../types"
import { buildAccessContext } from "../access/access-context-service"
import { createRuntimeBinding } from "../runtime-governance/runtime-binding-service"
import { auditService, sessionService } from "../store/store-singleton"
import { requireRuntimeSessionWorkspace } from "../workspace/workspace-access-service"
import { ensureWorkspaceForUser, requireSessionAction } from "./session-access-service"
import { resetSessionRuntime } from "./session-lifecycle-service"
import { markSessionActive, markSessionClosing, markSessionOpening } from "./session-status-machine-service"
import { buildSessionViewForUser } from "./session-summary-service"
import { listWorkspaceSharesForWorkspace } from "./workspace-share-application-service"
import { openSessionWithFallback, preopenSessionRuntime } from "./session-runtime-service"
import { assignWorkerForNewSession, ensureWorkerForSessionOpen } from "./session-worker-assignment-service"

export async function listUserSessionOverview(user: User) {
  const context = await buildAccessContext(user)
  const items = await Promise.all(context.sessions.map((session) => buildSessionViewForUser(user, session)))
  return {
    items,
    workspaces: context.workspaces
      .filter((workspace) => !context.sharedWorkspaceIds.has(workspace.id) && workspace.status === "active")
      .map((workspace) => ({
        ...workspace,
        canCreateSession: true,
      })),
  }
}

export async function createSessionForUser(input: {
  user: User
  requestId: string
  title: string
  projectId: string
  workspaceId: string
  warmup?: boolean
}) {
  const workspaceResult = await ensureWorkspaceForUser({
    user: input.user,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
  })
  if (!workspaceResult.ok) return workspaceResult

  const worker = input.warmup ? await assignWorkerForNewSession(input.user) : undefined
  if (input.warmup && !worker) return { ok: false as const, reason: "worker_not_found" }

  const session = await sessionService.createSession({
    title: input.title,
    projectId: input.projectId,
    workspace: workspaceResult.workspace,
    user: input.user,
    workerId: worker?.id || "",
  })
  if (worker) {
    await createRuntimeBinding({
      businessSessionId: session.id,
      workerId: worker.id,
    })
  }

  const auditLogTask = auditService.appendAuditLog({
    tenantId: input.user.tenantId,
    organizationId: input.user.organizationId,
    userId: input.user.id,
    businessSessionId: session.id,
    requestId: input.requestId,
    action: "session.create",
    resourceType: "business_session",
    resourceId: session.id,
    detail: {
      title: session.title,
      workspaceId: workspaceResult.workspace.id,
      workspacePath: workspaceResult.workspace.rootPath,
      workerId: worker?.id || null,
      warmup: Boolean(input.warmup),
    },
  })
  // 中文/English: session creation must not wait for audit durability before responding.
  void auditLogTask
  if (input.warmup) {
    preopenSessionRuntime(session)
  }

  return {
    ok: true as const,
    session: await buildSessionViewForUser(input.user, session),
  }
}

export async function getSessionDetailForUser(input: {
  user: User
  businessSessionId: string
}) {
  const result = await requireSessionAction({
    user: input.user,
    sessionId: input.businessSessionId,
    action: "read",
  })
  if (!result.ok) return result
  await waitForSessionEventWrites(result.session.id)
  const events = sessionService.listEvents(result.session.id)
  const shares = await listWorkspaceSharesForWorkspace(result.session.workspaceId)
  return {
    ok: true as const,
    session: await buildSessionViewForUser(input.user, result.session, events),
    events,
    shares,
  }
}

export async function closeSessionForUser(input: {
  user: User
  requestId: string
  businessSessionId: string
}) {
  const result = await requireSessionAction({
    user: input.user,
    sessionId: input.businessSessionId,
    action: "close",
  })
  if (!result.ok) return result

  await markSessionClosing(result.session.id)
  const closedReal = await closeRuntime(result.session.id)
  const closed = await resetSessionRuntime(result.session.id, "completed")
  const auditLogTask = auditService.appendAuditLog({
    tenantId: result.session.tenantId,
    organizationId: result.session.organizationId,
    userId: input.user.id,
    businessSessionId: result.session.id,
    requestId: input.requestId,
    action: "session.close",
    resourceType: "business_session",
    resourceId: result.session.id,
    detail: {
      closedReal,
    },
  })
  // 中文/English: closing should update the UI immediately; audit continues in background.
  void auditLogTask

  return {
    ok: true as const,
    session: await buildSessionViewForUser(input.user, closed || result.session),
  }
}

export async function openSessionForUser(input: {
  user: User
  requestId: string
  businessSessionId: string
}) {
  const result = await requireSessionAction({
    user: input.user,
    sessionId: input.businessSessionId,
    action: "open",
  })
  if (!result.ok) return result

  const workspaceResult = await requireRuntimeSessionWorkspace({
    user: input.user,
    session: result.session,
  })
  if (!workspaceResult.ok) return workspaceResult

  const recoverableSession = await prepareSessionForOpen(workspaceResult.session)
  await markSessionOpening(recoverableSession.id)
  const worker = await ensureWorkerForSessionOpen({
    user: input.user,
    session: recoverableSession,
  })
  if (!worker) {
    await resetSessionRuntime(recoverableSession.id, "created")
    return { ok: false as const, reason: "worker_not_found" }
  }

  const reopenedSession = (await sessionService.getSession(recoverableSession.id)) || recoverableSession
  const opened = await openSessionWithFallback(reopenedSession)
  if (!opened) {
    await resetSessionRuntime(recoverableSession.id, "created")
    return { ok: false as const, reason: "open_failed" }
  }

  const auditLogTask = auditService.appendAuditLog({
    tenantId: opened.tenantId,
    organizationId: opened.organizationId,
    userId: input.user.id,
    businessSessionId: opened.id,
    requestId: input.requestId,
    action: "session.open",
    resourceType: "business_session",
    resourceId: opened.id,
    detail: {
      workerId: worker.id,
    },
  })
  // 中文/English: runtime open should not block on audit persistence.
  void auditLogTask

  return {
    ok: true as const,
    session: await buildSessionViewForUser(input.user, opened),
  }
}

async function prepareSessionForOpen(session: import("../../types").BusinessSession) {
  if (session.status !== "orphaned" && session.status !== "failed") return session
  // 中文/English: if the user can still open the same session/workspace, recover the
  // runtime boundary transparently so reopening feels like a short reload, not a manual repair flow.
  await resetSessionRuntime(session.id, "created")
  return (await sessionService.getSession(session.id)) || session
}
