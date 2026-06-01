import { forkRealRuntime, loadRealRuntime, resumeRealRuntime } from "../../acp-runtime-manager"
import type { User } from "../../types"
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
  await loadRealRuntime(workspaceResult.session)
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
  await resumeRealRuntime(workspaceResult.session)
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
  const forkedSession = await sessionService.forkSession({
    source: result.session,
    title: input.title,
    user: input.user,
  })
  await forkRealRuntime(result.session, forkedSession)
  const opened = await sessionService.getSession(forkedSession.id)
  if (!opened) return { ok: false as const, reason: "session_not_found" }
  return { ok: true as const, session: await buildSessionViewForUser(input.user, opened) }
}
