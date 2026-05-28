import { getRuntimeDatabaseClient } from "../db/runtime-db"
import { now, nextId } from "../store/state-support"
import type { RuntimeLease } from "../types"

type RuntimeLeaseRow = {
  id: string
  business_session_id: string
  worker_node_id: string
  lease_owner: string
  lease_expires_at: string
  version: number
  created_at: string
  updated_at: string
}

function toRuntimeLease(row: RuntimeLeaseRow): RuntimeLease {
  return {
    id: row.id,
    businessSessionId: row.business_session_id,
    workerId: row.worker_node_id,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function findLeaseBySessionId(sessionId: string) {
  const db = getRuntimeDatabaseClient()
  const row = await db.queryFirst<RuntimeLeaseRow>(
    `
      SELECT
        id,
        business_session_id,
        worker_node_id,
        lease_owner,
        lease_expires_at,
        version,
        created_at,
        updated_at
      FROM runtime_lease
      WHERE business_session_id = ?
      LIMIT 1
    `,
    [sessionId],
  )
  if (!row) return
  return toRuntimeLease(row)
}

export async function listExpiredLeases(expireBefore: string) {
  const db = getRuntimeDatabaseClient()
  const rows = await db.queryRows<RuntimeLeaseRow>(
    `
      SELECT
        id,
        business_session_id,
        worker_node_id,
        lease_owner,
        lease_expires_at,
        version,
        created_at,
        updated_at
      FROM runtime_lease
      WHERE lease_expires_at < ?
      ORDER BY lease_expires_at ASC
    `,
    [expireBefore],
  )
  return rows.map(toRuntimeLease)
}

export async function listLatestLeases(limit = 20) {
  const db = getRuntimeDatabaseClient()
  const rows = await db.queryRows<RuntimeLeaseRow>(
    `
      SELECT
        id,
        business_session_id,
        worker_node_id,
        lease_owner,
        lease_expires_at,
        version,
        created_at,
        updated_at
      FROM runtime_lease
      ORDER BY updated_at DESC
      LIMIT ?
    `,
    [limit],
  )
  return rows.map(toRuntimeLease)
}

export async function upsertLease(input: {
  businessSessionId: string
  workerId: string
  leaseOwner: string
  leaseExpiresAt: string
}) {
  const current = await findLeaseBySessionId(input.businessSessionId)
  const db = getRuntimeDatabaseClient()
  const timestamp = now()
  if (!current) {
    const lease: RuntimeLease = {
      id: nextId("lease"),
      businessSessionId: input.businessSessionId,
      workerId: input.workerId,
      leaseOwner: input.leaseOwner,
      leaseExpiresAt: input.leaseExpiresAt,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await db.execute(
      `
        INSERT INTO runtime_lease (
          id,
          business_session_id,
          worker_node_id,
          lease_owner,
          lease_expires_at,
          version,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        lease.id,
        lease.businessSessionId,
        lease.workerId,
        lease.leaseOwner,
        lease.leaseExpiresAt,
        lease.version,
        lease.createdAt,
        lease.updatedAt,
      ],
    )
    return lease
  }
  const updated: RuntimeLease = {
    ...current,
    workerId: input.workerId,
    leaseOwner: input.leaseOwner,
    leaseExpiresAt: input.leaseExpiresAt,
    version: current.version + 1,
    updatedAt: timestamp,
  }
  await db.execute(
    `
      UPDATE runtime_lease
      SET
        worker_node_id = ?,
        lease_owner = ?,
        lease_expires_at = ?,
        version = ?,
        updated_at = ?
      WHERE id = ?
    `,
    [
      updated.workerId,
      updated.leaseOwner,
      updated.leaseExpiresAt,
      updated.version,
      updated.updatedAt,
      updated.id,
    ],
  )
  return updated
}

export async function deleteLeaseBySessionId(sessionId: string) {
  const db = getRuntimeDatabaseClient()
  await db.execute(
    `
      DELETE FROM runtime_lease
      WHERE business_session_id = ?
    `,
    [sessionId],
  )
}
