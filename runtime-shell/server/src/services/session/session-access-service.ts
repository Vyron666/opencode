import { stat } from "node:fs/promises"
import { sessionService, workspaceService } from "../store/store-singleton"
import type { BusinessSession, User, WorkspaceAccessResult } from "../../types"

export type BusinessSessionAccessResult =
  | {
      ok: true
      session: BusinessSession
    }
  | {
      ok: false
      reason: "session_not_found" | "forbidden"
    }

export async function findBusinessSessionForUser(sessionId: string, user?: User): Promise<BusinessSessionAccessResult> {
  const session = await sessionService.getSession(sessionId)
  if (!session) return { ok: false, reason: "session_not_found" }
  if (user && (session.tenantId !== user.tenantId || session.organizationId !== user.organizationId)) {
    return { ok: false, reason: "forbidden" }
  }
  return { ok: true, session }
}

export async function ensureWorkspaceForUser(input: {
  user: User
  projectId: string
  workspaceId: string
}): Promise<WorkspaceAccessResult> {
  const workspace = await workspaceService.getWorkspace(input.workspaceId)
  if (!workspace) return { ok: false, reason: "workspace_not_found" }
  if (workspace.tenantId !== input.user.tenantId || workspace.organizationId !== input.user.organizationId) {
    return { ok: false, reason: "forbidden" }
  }
  if (workspace.projectId !== input.projectId) {
    return { ok: false, reason: "forbidden" }
  }
  const info = await stat(workspace.rootPath).catch(() => null)
  if (!info?.isDirectory()) return { ok: false, reason: "invalid_path" }
  return { ok: true, workspace }
}
