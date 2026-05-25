import { now, nextId } from "../store/state-support"
import type { PersistedState, User } from "../types"
import { deleteAuthSession, findAuthSession, getUser, insertAuthSession, listAuthSessions } from "./state-repo"

export function listSessions(state: PersistedState) {
  return listAuthSessions(state)
}

export function findSession(state: PersistedState, tokenHash: string) {
  return findAuthSession(state, tokenHash)
}

export function findUserById(state: PersistedState, userId: string) {
  return getUser(state, userId)
}

export function createSession(state: PersistedState, input: {
  user: User
  tokenHash: string
  expiresAt: string
}) {
  const timestamp = now()
  return insertAuthSession(state, {
    id: nextId("auth"),
    userId: input.user.id,
    tenantId: input.user.tenantId,
    organizationId: input.user.organizationId,
    tokenHash: input.tokenHash,
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: input.expiresAt,
  })
}

export function removeSession(state: PersistedState, tokenHash: string) {
  return deleteAuthSession(state, tokenHash)
}
