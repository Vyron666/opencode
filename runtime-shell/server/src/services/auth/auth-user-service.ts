import { getSession } from "../../auth"
import type { User } from "../../types"

export async function getUserBySessionToken(token?: string | null) {
  return getSession(token)
}

export function sanitizeUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    tenantId: user.tenantId,
    organizationId: user.organizationId,
  }
}
