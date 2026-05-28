import { buildAccessContext } from "../access/access-context-service"
import { authorizeSessionAction, type SessionAction } from "../access/authorization-service"
import { sessionService } from "../store/store-singleton"
import type { BusinessSession, User } from "../../types"

export { ensureWorkspaceForUser } from "../workspace/workspace-access-service"

export type BusinessSessionAccessResult =
  | {
      ok: true
      session: BusinessSession
    }
  | {
      ok: false
      reason: "session_not_found" | "forbidden" | "workspace_not_shared" | "share_revoked" | "scope_mismatch"
    }

export async function findBusinessSessionForUser(sessionId: string, user?: User): Promise<BusinessSessionAccessResult> {
  const session = await sessionService.getSession(sessionId)
  if (!session) return { ok: false, reason: "session_not_found" }
  if (!user) return { ok: true, session }
  const context = await buildAccessContext(user)
  // 中文/English: P1-C reads must resolve session visibility from one shared
  // access context instead of each caller hand-writing its own boundary logic.
  if (!context.sessionIds.has(session.id)) {
    return { ok: false, reason: "scope_mismatch" }
  }
  return { ok: true, session }
}

export async function requireSessionAction(input: {
  user: User
  sessionId: string
  action: SessionAction
}): Promise<BusinessSessionAccessResult> {
  const sessionResult = await findBusinessSessionForUser(input.sessionId, input.user)
  if (!sessionResult.ok) return sessionResult
  const authorization = await authorizeSessionAction({
    user: input.user,
    session: sessionResult.session,
    action: input.action,
  })
  if (!authorization.ok) return { ok: false, reason: authorization.reason }
  return sessionResult
}
