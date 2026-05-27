import { createHash } from "node:crypto"
import { Config } from "./config"
import { authService, userService } from "./services/store/store-singleton"
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
  await authService.createAuthSession({
    user,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  })
  return token
}

export async function getSession(token?: string | null) {
  if (!token) return
  const tokenHash = hashToken(token)
  const authSession = await authService.findAuthSession(tokenHash)
  if (!authSession) return
  if (authSession.status !== "active") return
  if (new Date(authSession.expiresAt).getTime() <= Date.now()) {
    await authService.expireAuthSession(tokenHash)
    return
  }
  return userService.getUser(authSession.userId)
}

export async function clearSession(token?: string | null) {
  if (!token) return false
  return authService.deleteAuthSession(hashToken(token))
}
