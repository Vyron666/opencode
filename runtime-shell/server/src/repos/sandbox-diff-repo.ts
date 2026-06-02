import { getRuntimeDatabaseClient } from "../db/runtime-db"
import type { SandboxDiff, SandboxDiffStatus } from "../types"

type SandboxDiffRow = {
  id: string
  tenant_id: string
  organization_id: string
  project_id: string
  workspace_id: string
  business_session_id: string
  sandbox_workspace_id: string
  workspace_mode: "copy"
  status: SandboxDiffStatus
  summary_json: string
  artifact_uri: string | null
  policy_result_json: string
  idempotency_key: string | null
  created_by: string
  created_at: string
  updated_at: string
  applied_at: string | null
  rejected_at: string | null
  expires_at: string | null
}

export async function createSandboxDiff(input: SandboxDiff) {
  await getRuntimeDatabaseClient().execute(
    `
      INSERT INTO sandbox_diff (
        id,
        tenant_id,
        organization_id,
        project_id,
        workspace_id,
        business_session_id,
        sandbox_workspace_id,
        workspace_mode,
        status,
        summary_json,
        artifact_uri,
        policy_result_json,
        idempotency_key,
        created_by,
        created_at,
        updated_at,
        applied_at,
        rejected_at,
        expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      input.id,
      input.tenantId,
      input.organizationId,
      input.projectId,
      input.workspaceId,
      input.businessSessionId,
      input.sandboxWorkspaceId,
      input.workspaceMode,
      input.status,
      JSON.stringify(input.summary),
      input.artifactUri || null,
      JSON.stringify(input.policyResult),
      input.idempotencyKey || null,
      input.createdBy,
      input.createdAt,
      input.updatedAt,
      input.appliedAt || null,
      input.rejectedAt || null,
      input.expiresAt || null,
    ],
  )
}

export async function findLatestSandboxDiffBySessionId(businessSessionId: string) {
  const row = await getRuntimeDatabaseClient().queryFirst<SandboxDiffRow>(
    `
      SELECT
        id,
        tenant_id,
        organization_id,
        project_id,
        workspace_id,
        business_session_id,
        sandbox_workspace_id,
        workspace_mode,
        status,
        summary_json,
        artifact_uri,
        policy_result_json,
        idempotency_key,
        created_by,
        created_at,
        updated_at,
        applied_at,
        rejected_at,
        expires_at
      FROM sandbox_diff
      WHERE business_session_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [businessSessionId],
  )
  if (!row) return
  return toSandboxDiff(row)
}

export async function findSandboxDiffById(diffId: string) {
  const row = await getRuntimeDatabaseClient().queryFirst<SandboxDiffRow>(
    `
      SELECT
        id,
        tenant_id,
        organization_id,
        project_id,
        workspace_id,
        business_session_id,
        sandbox_workspace_id,
        workspace_mode,
        status,
        summary_json,
        artifact_uri,
        policy_result_json,
        idempotency_key,
        created_by,
        created_at,
        updated_at,
        applied_at,
        rejected_at,
        expires_at
      FROM sandbox_diff
      WHERE id = ?
      LIMIT 1
    `,
    [diffId],
  )
  if (!row) return
  return toSandboxDiff(row)
}

export async function updateSandboxDiffStatus(input: {
  diffId: string
  status: SandboxDiffStatus
  updatedAt: string
  appliedAt?: string
  rejectedAt?: string
  idempotencyKey?: string
}) {
  await getRuntimeDatabaseClient().execute(
    `
      UPDATE sandbox_diff
      SET
        status = ?,
        updated_at = ?,
        applied_at = ?,
        rejected_at = ?,
        idempotency_key = COALESCE(?, idempotency_key)
      WHERE id = ?
    `,
    [
      input.status,
      input.updatedAt,
      input.appliedAt || null,
      input.rejectedAt || null,
      input.idempotencyKey || null,
      input.diffId,
    ],
  )
}

function toSandboxDiff(row: SandboxDiffRow): SandboxDiff {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    workspaceId: row.workspace_id,
    businessSessionId: row.business_session_id,
    sandboxWorkspaceId: row.sandbox_workspace_id,
    workspaceMode: row.workspace_mode,
    status: row.status,
    summary: JSON.parse(row.summary_json) as SandboxDiff["summary"],
    artifactUri: row.artifact_uri || undefined,
    policyResult: JSON.parse(row.policy_result_json) as SandboxDiff["policyResult"],
    idempotencyKey: row.idempotency_key || undefined,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    appliedAt: row.applied_at || undefined,
    rejectedAt: row.rejected_at || undefined,
    expiresAt: row.expires_at || undefined,
  }
}
