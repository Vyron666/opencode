import { closeRuntime } from "../../acp-runtime-manager"
import { waitForSessionEventWrites } from "../../runtime/runtime-events"
import { createLogger } from "../../log"
import type { User } from "../../types"
import { buildAccessContext } from "../access/access-context-service"
import { createRuntimeBinding } from "../runtime-governance/runtime-binding-service"
import { auditService, sessionService } from "../store/store-singleton"
import { isSessionWorkspaceReady, requireRuntimeSessionWorkspace } from "../workspace/workspace-access-service"
import { ensureWorkspaceForUser, requireSessionAction } from "./session-access-service"
import { resetSessionRuntime } from "./session-lifecycle-service"
import { markSessionClosing, markSessionOpening } from "./session-status-machine-service"
import { buildSessionViewForUser } from "./session-summary-service"
import { listWorkspaceSharesForWorkspace } from "./workspace-share-application-service"
import { openSessionWithFallback, preopenSessionRuntime } from "./session-runtime-service"
import { assignWorkerForNewSession, ensureWorkerForSessionOpen, reassignWorkerForSessionOpen } from "./session-worker-assignment-service"
import { closeSandboxWorkspace, ensureSandboxWorkspace, markSandboxWorkspaceClosing } from "../sandbox/sandbox-workspace-service"

const log = createLogger("session-application-service")

export async function listUserSessionOverview(user: User) {
  const context = await buildAccessContext(user)
  const items = await Promise.all(context.sessions.map((session) => buildSessionViewForUser(user, session)))
  const visibleWorkspaceEntries = await Promise.all(
    context.workspaces.map(async (workspace) =>
      !context.sharedWorkspaceIds.has(workspace.id)
      && workspace.status === "active"
      && await isSessionWorkspaceReady(workspace)
        ? workspace
        : null,
    ),
  )
  return {
    items,
    workspaces: visibleWorkspaceEntries
      .filter(isPresent)
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
    void ensureSandboxWorkspace(session)
      .then(() => preopenSessionRuntime(session))
      .catch((error) => {
        log.warn("session warmup sandbox prepare failed", {
          businessSessionId: session.id,
          workspacePath: session.workspacePath,
          workerId: session.workerId,
          message: error instanceof Error ? error.message : String(error),
        })
      })
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
  await markSandboxWorkspaceClosing(result.session.id)
  const closedReal = await closeRuntime(result.session.id)
  const closed = await resetSessionRuntime(result.session.id, "completed")
  await closeSandboxWorkspace(result.session.id)
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
  try {
    const sandboxWorkspace = await ensureSandboxWorkspace(recoverableSession)
    log.info("session sandbox workspace prepared", {
      businessSessionId: recoverableSession.id,
      workspacePath: recoverableSession.workspacePath,
      sandboxPath: sandboxWorkspace.sandboxPath,
    })
  } catch (error) {
    log.warn("session sandbox workspace prepare failed", {
      businessSessionId: recoverableSession.id,
      workspacePath: recoverableSession.workspacePath,
      message: error instanceof Error ? error.message : String(error),
    })
    await resetSessionRuntime(recoverableSession.id, "created")
    return { ok: false as const, reason: "open_failed" }
  }
  await markSessionOpening(recoverableSession.id)
  const worker = await ensureWorkerForSessionOpen({
    user: input.user,
    session: recoverableSession,
  }).catch(async (error) => {
    log.warn("session worker assignment failed", {
      businessSessionId: recoverableSession.id,
      workspacePath: recoverableSession.workspacePath,
      workerId: recoverableSession.workerId,
      message: error instanceof Error ? error.message : String(error),
    })
    await resetSessionRuntime(recoverableSession.id, "created")
    return undefined
  })
  if (!worker) {
    log.warn("session open has no worker", {
      businessSessionId: recoverableSession.id,
      workspacePath: recoverableSession.workspacePath,
      workerId: recoverableSession.workerId,
    })
    await resetSessionRuntime(recoverableSession.id, "created")
    return { ok: false as const, reason: "worker_not_found" }
  }

  const reopenedSession = (await sessionService.getSession(recoverableSession.id)) || recoverableSession
  const firstOpenAttempt = await openSessionWithFallback(reopenedSession).catch(async (error) => {
    log.warn("session runtime open failed", {
      businessSessionId: reopenedSession.id,
      workerId: reopenedSession.workerId,
      workspacePath: reopenedSession.workspacePath,
      message: error instanceof Error ? error.message : String(error),
    })
    return undefined
  })
  const opened = firstOpenAttempt || await retrySessionOpenOnAnotherWorker({
    user: input.user,
    session: reopenedSession,
    failedWorkerId: worker.id,
  })
  if (!opened) return { ok: false as const, reason: "open_failed" }

  const openedWorker = await ensureWorkerForSessionOpen({
    user: input.user,
    session: opened,
  })
  if (!openedWorker) {
    await resetSessionRuntime(opened.id, "created")
    return { ok: false as const, reason: "worker_not_found" }
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
      workerId: openedWorker.id,
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

async function retrySessionOpenOnAnotherWorker(input: {
  user: User
  session: import("../../types").BusinessSession
  failedWorkerId: string
}) {
  const fallbackWorker = await reassignWorkerForSessionOpen({
    user: input.user,
    session: input.session,
    excludedWorkerIds: [input.failedWorkerId],
  })
  if (!fallbackWorker) {
    await resetSessionRuntime(input.session.id, "created")
    return
  }
  const failoverSession = (await sessionService.getSession(input.session.id)) || input.session
  return openSessionWithFallback(failoverSession).catch(async (error) => {
    log.warn("session runtime open retry failed", {
      businessSessionId: failoverSession.id,
      workerId: failoverSession.workerId,
      workspacePath: failoverSession.workspacePath,
      message: error instanceof Error ? error.message : String(error),
    })
    await resetSessionRuntime(failoverSession.id, "created")
    return undefined
  })
}

function isPresent<T>(value: T | null): value is T {
  return value !== null
}
