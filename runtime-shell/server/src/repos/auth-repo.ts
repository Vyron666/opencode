import { nextId, now } from "../store/state-support"
import { getRuntimeDatabaseClient } from "../db/runtime-db"
import type { AuthSession, User } from "../types"

type AuthSessionRow = {
  id: string
  user_id: string
  tenant_id: string
  organization_id: string
  token_hash: string
  created_at: string
  updated_at: string
  expires_at: string
}

function toAuthSession(row: AuthSessionRow): AuthSession {
  return {
    id: row.id,
    userId: row.user_id,
    tenantId: row.tenant_id,
    organizationId: row.organization_id,
    tokenHash: row.token_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  }
}

export async function listSessions() {
  const db = getRuntimeDatabaseClient()
  const rows = await db.queryRows<AuthSessionRow>(
    `
      SELECT
        id,
        user_id,
        tenant_id,
        organization_id,
        token_hash,
        created_at,
        updated_at,
        expires_at
      FROM auth_session
      WHERE deleted_at IS NULL
      ORDER BY created_at DESC
    `,
  )
  return rows.map(toAuthSession)
}

export async function findSession(tokenHash: string) {
  const db = getRuntimeDatabaseClient()
  const row = await db.queryFirst<AuthSessionRow>(
    `
      SELECT
        id,
        user_id,
        tenant_id,
        organization_id,
        token_hash,
        created_at,
        updated_at,
        expires_at
      FROM auth_session
      WHERE token_hash = ?
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [tokenHash],
  )
  if (!row) return
  return toAuthSession(row)
}

export async function createSession(input: {
  user: User
  tokenHash: string
  expiresAt: string
}) {
  const db = getRuntimeDatabaseClient()
  const timestamp = now()
  const authSession: AuthSession = {
    id: nextId("auth"),
    userId: input.user.id,
    tenantId: input.user.tenantId,
    organizationId: input.user.organizationId,
    tokenHash: input.tokenHash,
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: input.expiresAt,
  }
  await db.execute(
    `
      INSERT INTO auth_session (
        id,
        tenant_id,
        organization_id,
        user_id,
        token_hash,
        expires_at,
        created_at,
        created_by,
        updated_at,
        updated_by,
        deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      authSession.id,
      authSession.tenantId,
      authSession.organizationId,
      authSession.userId,
      authSession.tokenHash,
      authSession.expiresAt,
      authSession.createdAt,
      authSession.userId,
      authSession.updatedAt,
      authSession.userId,
      null,
    ],
  )
  return authSession
}

export async function removeSession(tokenHash: string) {
  const db = getRuntimeDatabaseClient()
  const existing = await findSession(tokenHash)
  if (!existing) return false
  await db.execute("DELETE FROM auth_session WHERE token_hash = ?", [tokenHash])
  return true
}
