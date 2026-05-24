import { createHash } from "node:crypto"
import { Config } from "./config"
import { store } from "./store"
import type { User } from "./types"

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

function hashToken(token: string) {
  return createHash("sha256").update(`${token}:${Config.sessionSecret}`).digest("hex")
}

export function signSessionToken(user: User) {
  // 中文/English: token generation is deterministic enough for a managed server session,
  // while the persisted hash keeps the raw cookie value out of storage.
  const seed = `${user.id}:${user.username}:${Date.now()}:${crypto.randomUUID()}:${Config.sessionSecret}`
  return createHash("sha256").update(seed).digest("hex")
}

export async function createSession(user: User) {
  const token = signSessionToken(user)
  await store.createAuthSession({
    user,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  })
  return token
}

export function getSession(token?: string | null) {
  if (!token) return
  const authSession = store.findAuthSession(hashToken(token))
  if (!authSession) return
  if (new Date(authSession.expiresAt).getTime() <= Date.now()) return
  return store.getUser(authSession.userId)
}

export async function clearSession(token?: string | null) {
  if (!token) return false
  return store.deleteAuthSession(hashToken(token))
}
