import type { BusinessSession } from "../../types"

type SessionLookup = {
  listSessionsByFilter(input: {
    workspaceId?: string
    statuses?: BusinessSession["status"][]
  }): Promise<BusinessSession[]>
}

export async function hasReusableWorkspaceSessions(input: {
  sessionService: SessionLookup
  workspaceId: string
  excludedSessionIds?: string[]
}) {
  const excluded = new Set(input.excludedSessionIds || [])
  const sessions = (await input.sessionService.listSessionsByFilter({
    workspaceId: input.workspaceId,
    statuses: ["opening", "active", "waiting_input", "cancelling", "closing", "orphaned"],
  })).filter((session) => !excluded.has(session.id))
  return sessions.some((session) =>
    session.status === "opening" ||
    session.status === "active" ||
    session.status === "waiting_input" ||
    session.status === "cancelling" ||
    session.status === "closing" ||
    // 中文/English: orphaned sessions still have a user-visible reopen path.
    session.status === "orphaned",
  )
}

export async function hasLiveWorkspaceSessions(input: {
  sessionService: SessionLookup
  workspaceId: string
  excludedSessionIds?: string[]
}) {
  const excluded = new Set(input.excludedSessionIds || [])
  const sessions = (await input.sessionService.listSessionsByFilter({
    workspaceId: input.workspaceId,
    statuses: ["opening", "active", "waiting_input", "cancelling", "closing"],
  })).filter((session) => !excluded.has(session.id))
  return sessions.some((session) =>
    session.status === "opening" ||
    session.status === "active" ||
    session.status === "waiting_input" ||
    session.status === "cancelling" ||
    session.status === "closing",
  )
}
