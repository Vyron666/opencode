import { getRuntimeDatabaseClient } from "../db/runtime-db"
import type { SandboxInstance, SandboxInstanceStatus } from "../types"

type SandboxInstanceRow = {
  id: string
  tenant_id: string
  organization_id: string
  project_id: string
  workspace_id: string
  business_session_id: string
  worker_node_id: string
  backend: SandboxInstance["backend"]
  runtime_class: string | null
  isolation_mode: string | null
  status: SandboxInstanceStatus
  sandbox_path: string
  detail_json: string | null
  created_at: string
  updated_at: string
  opened_at: string | null
  closed_at: string | null
}

const SANDBOX_INSTANCE_SELECT = `
  SELECT
    id,
    tenant_id,
    organization_id,
    project_id,
    workspace_id,
    business_session_id,
    worker_node_id,
    backend,
    runtime_class,
    isolation_mode,
    status,
    sandbox_path,
    detail_json,
    created_at,
    updated_at,
    opened_at,
    closed_at
  FROM sandbox_instance
`

export async function findSandboxInstanceBySessionId(businessSessionId: string) {
  const row = await getRuntimeDatabaseClient().queryFirst<SandboxInstanceRow>(
    `
      ${SANDBOX_INSTANCE_SELECT}
      WHERE business_session_id = ?
      LIMIT 1
    `,
    [businessSessionId],
  )
  if (!row) return
  return toSandboxInstance(row)
}

export async function findSandboxInstanceByWorkspaceId(workspaceId: string) {
  const row = await getRuntimeDatabaseClient().queryFirst<SandboxInstanceRow>(
    `
      ${SANDBOX_INSTANCE_SELECT}
      WHERE workspace_id = ?
      LIMIT 1
    `,
    [workspaceId],
  )
  if (!row) return
  return toSandboxInstance(row)
}

export async function findSandboxInstanceById(id: string) {
  const row = await getRuntimeDatabaseClient().queryFirst<SandboxInstanceRow>(
    `
      ${SANDBOX_INSTANCE_SELECT}
      WHERE id = ?
      LIMIT 1
    `,
    [id],
  )
  if (!row) return
  return toSandboxInstance(row)
}

export async function listSandboxInstances(limit = 100) {
  const rows = await getRuntimeDatabaseClient().queryRows<SandboxInstanceRow>(
    `
      ${SANDBOX_INSTANCE_SELECT}
      ORDER BY updated_at DESC
      LIMIT ?
    `,
    [limit],
  )
  return rows.map(toSandboxInstance)
}

export async function listSandboxInstancesByWorker(workerId: string) {
  const rows = await getRuntimeDatabaseClient().queryRows<SandboxInstanceRow>(
    `
      ${SANDBOX_INSTANCE_SELECT}
      WHERE worker_node_id = ?
      ORDER BY updated_at DESC
    `,
    [workerId],
  )
  return rows.map(toSandboxInstance)
}

export async function countSandboxInstancesByWorkerStatus(workerId: string, statuses: SandboxInstanceStatus[]) {
  if (!statuses.length) return 0
  const placeholders = statuses.map(() => "?").join(", ")
  const row = await getRuntimeDatabaseClient().queryFirst<{ count: number }>(
    `
      SELECT COUNT(*) AS count
      FROM sandbox_instance
      WHERE worker_node_id = ?
        AND status IN (${placeholders})
    `,
    [workerId, ...statuses],
  )
  return Number(row?.count || 0)
}

export async function upsertSandboxInstance(input: SandboxInstance) {
  const existing = await findSandboxInstanceById(input.id)
  if (!existing) {
    await getRuntimeDatabaseClient().execute(
      `
        INSERT INTO sandbox_instance (
          id,
          tenant_id,
          organization_id,
          project_id,
          workspace_id,
          business_session_id,
          worker_node_id,
          backend,
          runtime_class,
          isolation_mode,
          status,
          sandbox_path,
          detail_json,
          created_at,
          updated_at,
          opened_at,
          closed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        input.id,
        input.tenantId,
        input.organizationId,
        input.projectId,
        input.workspaceId,
        input.businessSessionId,
        input.workerId,
        input.backend,
        input.runtimeClass || null,
        input.isolationMode || null,
        input.status,
        input.sandboxPath,
        input.detail ? JSON.stringify(input.detail) : null,
        input.createdAt,
        input.updatedAt,
        input.openedAt || null,
        input.closedAt || null,
      ],
    )
    return input
  }

  await getRuntimeDatabaseClient().execute(
    `
      UPDATE sandbox_instance
      SET
        tenant_id = ?,
        organization_id = ?,
        project_id = ?,
        workspace_id = ?,
        business_session_id = ?,
        worker_node_id = ?,
        backend = ?,
        runtime_class = ?,
        isolation_mode = ?,
        status = ?,
        sandbox_path = ?,
        detail_json = ?,
        updated_at = ?,
        opened_at = ?,
        closed_at = ?
      WHERE id = ?
    `,
    [
      input.tenantId,
      input.organizationId,
      input.projectId,
      input.workspaceId,
      input.businessSessionId,
      input.workerId,
      input.backend,
      input.runtimeClass || null,
      input.isolationMode || null,
      input.status,
      input.sandboxPath,
      input.detail ? JSON.stringify(input.detail) : null,
      input.updatedAt,
      input.openedAt || null,
      input.closedAt || null,
      input.id,
    ],
  )
  return findSandboxInstanceById(input.id)
}

export async function deleteSandboxInstanceById(id: string) {
  await getRuntimeDatabaseClient().execute(
    `
      DELETE FROM sandbox_instance
      WHERE id = ?
    `,
    [id],
  )
}

export async function deleteSandboxInstanceBySessionId(businessSessionId: string) {
  await getRuntimeDatabaseClient().execute(
    `
      DELETE FROM sandbox_instance
      WHERE business_session_id = ?
    `,
    [businessSessionId],
  )
}

export async function deleteSandboxInstanceByWorkspaceId(workspaceId: string) {
  await getRuntimeDatabaseClient().execute(
    `
      DELETE FROM sandbox_instance
      WHERE workspace_id = ?
    `,
    [workspaceId],
  )
}

function toSandboxInstance(row: SandboxInstanceRow): SandboxInstance {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    workspaceId: row.workspace_id,
    businessSessionId: row.business_session_id,
    workerId: row.worker_node_id,
    backend: row.backend,
    runtimeClass: row.runtime_class || undefined,
    isolationMode: row.isolation_mode || undefined,
    status: row.status,
    sandboxPath: row.sandbox_path,
    detail: row.detail_json ? JSON.parse(row.detail_json) as Record<string, unknown> : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    openedAt: row.opened_at || undefined,
    closedAt: row.closed_at || undefined,
  }
}
