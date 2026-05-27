import { closeRuntime } from "../../acp-runtime-manager"
import type { User } from "../../types"
import { ensureWorkspaceForUser, findBusinessSessionForUser } from "./session-access-service"
import { resetSessionRuntime } from "./session-lifecycle-service"
import { openSessionWithFallback } from "./session-runtime-service"
import { sessionSummary } from "./session-summary-service"
import { auditService, sessionService, workerService, workspaceService } from "../store/store-singleton"

export async function listUserSessionOverview(user: User) {
  return {
    items: (await sessionService.listUserSessions(user)).map(sessionSummary),
    workspaces: await workspaceService.listUserWorkspaces(user),
  }
}

export async function createSessionForUser(input: {
  user: User
  requestId: string
  title: string
  projectId: string
  workspaceId: string
}) {
  const worker = workerService.listWorkers()[0]
  if (!worker) return { ok: false as const, reason: "worker_not_found" }

  const workspaceResult = await ensureWorkspaceForUser({
    user: input.user,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
  })
  if (!workspaceResult.ok) return workspaceResult

  const session = await sessionService.createSession({
    title: input.title,
    projectId: input.projectId,
    workspace: workspaceResult.workspace,
    user: input.user,
    workerId: worker.id,
  })
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
    },
  })
  // 中文/English: session creation must not wait for audit durability before responding.
  void auditLogTask

  return {
    ok: true as const,
    session: sessionSummary(session),
  }
}

export async function getSessionDetailForUser(input: {
  user: User
  businessSessionId: string
}) {
  const result = await findBusinessSessionForUser(input.businessSessionId, input.user)
  if (!result.ok) return result
  return {
    ok: true as const,
    session: sessionSummary(result.session),
    events: sessionService.listEvents(result.session.id),
  }
}

export async function closeSessionForUser(input: {
  user: User
  requestId: string
  businessSessionId: string
}) {
  const result = await findBusinessSessionForUser(input.businessSessionId, input.user)
  if (!result.ok) return result

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
    session: sessionSummary(closed || result.session),
  }
}

export async function openSessionForUser(input: {
  user: User
  requestId: string
  businessSessionId: string
}) {
  const result = await findBusinessSessionForUser(input.businessSessionId, input.user)
  if (!result.ok) return result

  const workspace = await workspaceService.getWorkspace(result.session.workspaceId)
  const opened = await openSessionWithFallback(result.session, workspace)
  if (!opened) return { ok: false as const, reason: "open_failed" }

  const auditLogTask = auditService.appendAuditLog({
    tenantId: opened.tenantId,
    organizationId: opened.organizationId,
    userId: input.user.id,
    businessSessionId: opened.id,
    requestId: input.requestId,
    action: "session.open",
    resourceType: "business_session",
    resourceId: opened.id,
    detail: {},
  })
  // 中文/English: runtime open should not block on audit persistence.
  void auditLogTask

  return {
    ok: true as const,
    session: sessionSummary(opened),
  }
}
