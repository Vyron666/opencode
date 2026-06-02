import type { User } from "../../types"
import { requireSessionAction } from "../session/session-access-service"
import { applySessionDiff, createSessionDiff, getLatestSessionDiff, rejectSessionDiff } from "./sandbox-diff-service"

export async function createSessionDiffForUser(input: {
  user: User
  businessSessionId: string
}) {
  const sessionResult = await requireSessionAction({
    user: input.user,
    sessionId: input.businessSessionId,
    action: "open",
  })
  if (!sessionResult.ok) return sessionResult
  const diff = await createSessionDiff({
    session: sessionResult.session,
    user: input.user,
  })
  if (!diff) return { ok: false as const, reason: "sandbox_workspace_not_found" }
  return { ok: true as const, diff }
}

export async function getSessionDiffForUser(input: {
  user: User
  businessSessionId: string
}) {
  const sessionResult = await requireSessionAction({
    user: input.user,
    sessionId: input.businessSessionId,
    action: "read",
  })
  if (!sessionResult.ok) return sessionResult
  const diff = await getLatestSessionDiff(sessionResult.session.id)
  if (!diff) return { ok: false as const, reason: "sandbox_diff_not_found" }
  return { ok: true as const, diff }
}

export async function applySessionDiffForUser(input: {
  user: User
  businessSessionId: string
  diffId: string
  idempotencyKey: string
}) {
  const sessionResult = await requireSessionAction({
    user: input.user,
    sessionId: input.businessSessionId,
    action: "open",
  })
  if (!sessionResult.ok) return sessionResult
  const diff = await applySessionDiff({
    session: sessionResult.session,
    diffId: input.diffId,
    idempotencyKey: input.idempotencyKey,
  })
  if (!diff) return { ok: false as const, reason: "sandbox_workspace_not_found" }
  return { ok: true as const, diff }
}

export async function rejectSessionDiffForUser(input: {
  user: User
  businessSessionId: string
  diffId: string
}) {
  const sessionResult = await requireSessionAction({
    user: input.user,
    sessionId: input.businessSessionId,
    action: "open",
  })
  if (!sessionResult.ok) return sessionResult
  const diff = await rejectSessionDiff({
    diffId: input.diffId,
  })
  if (!diff) return { ok: false as const, reason: "sandbox_diff_not_found" }
  return { ok: true as const, diff }
}
