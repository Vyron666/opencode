import { listPendingPermissions, listPendingQuestions } from "../../acp-runtime-manager"
import * as RuntimeFailureLogRepo from "../../repos/runtime-failure-log-repo"
import * as RuntimeLeaseRepo from "../../repos/runtime-lease-repo"
import * as SessionRuntimeBindingRepo from "../../repos/session-runtime-binding-repo"
import { workspaceShareService } from "../store/store-singleton"
import { sessionService } from "../store/store-singleton"
import type { BusinessSession, User } from "../../types"

export async function buildSessionViewForUser(user: User, session: BusinessSession) {
  const [binding, lease, failures, workspaceShare] = await Promise.all([
    SessionRuntimeBindingRepo.findActiveBindingBySessionId(session.id),
    RuntimeLeaseRepo.findLeaseBySessionId(session.id),
    RuntimeFailureLogRepo.listRecentRuntimeFailuresBySession(session.id, 1),
    session.createdBy === user.id || user.role === "admin"
      ? Promise.resolve(null)
      : workspaceShareService.findShareForWorkspaceTarget({
          workspaceId: session.workspaceId,
          targetUserId: user.id,
        }),
  ])
  const isOwner = session.createdBy === user.id
  const isAdmin = user.role === "admin"
  const isWorkspaceShared = !isAdmin && !isOwner && workspaceShare?.status === "active"
  const lastFailure = failures[0] || null

  return {
    ...session,
    eventCount: sessionService.listEvents(session.id).length,
    pendingPermissions: listPendingPermissions(session.id),
    pendingQuestions: listPendingQuestions(session.id),
    visibility: isAdmin ? "admin" : isOwner ? "owner" : isWorkspaceShared ? "workspace_share" : "scoped",
    capabilities: {
      open: true,
      load: true,
      resume: true,
      prompt: true,
      cancel: true,
      respondPermission: true,
      respondQuestion: true,
      close: isAdmin || isOwner,
      fork: isAdmin || isOwner,
      shareWorkspace: isAdmin || isOwner,
      updateMode: isAdmin || isOwner,
      updateModel: isAdmin || isOwner,
      updateConfig: isAdmin || isOwner,
      recover: session.status === "orphaned" || session.status === "failed",
    },
    runtimeHint: {
      needsRecovery: session.status === "orphaned" || session.status === "failed",
      recoverable: session.status === "orphaned" || session.status === "failed",
      bindingStatus: binding?.bindingStatus || "released",
      hasLease: Boolean(lease),
      leaseExpiresAt: lease?.leaseExpiresAt,
      lastFailure,
      message: readRuntimeHintMessage(session.status, binding?.bindingStatus, Boolean(lease), lastFailure?.message),
    },
  }
}

function readRuntimeHintMessage(
  status: BusinessSession["status"],
  bindingStatus?: string,
  hasLease?: boolean,
  lastFailureMessage?: string,
) {
  if (status === "orphaned" || status === "failed") {
    return lastFailureMessage || "\u4f1a\u8bdd\u8fd0\u884c\u65f6\u9700\u8981\u6062\u590d\u540e\u624d\u80fd\u7ee7\u7eed\u4f7f\u7528"
  }
  if (!hasLease && (status === "active" || status === "waiting_input" || status === "cancelling")) {
    return "\u4f1a\u8bdd\u6b63\u5728\u7b49\u5f85\u8fd0\u884c\u65f6\u91cd\u65b0\u63a5\u7ba1"
  }
  if (bindingStatus === "lost") {
    return "\u4f1a\u8bdd\u8fd0\u884c\u65f6\u7ed1\u5b9a\u5df2\u4e22\u5931\uff0c\u91cd\u65b0\u6253\u5f00\u65f6\u4f1a\u81ea\u52a8\u6062\u590d"
  }
  return ""
}
