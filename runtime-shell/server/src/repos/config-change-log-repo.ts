import { getRuntimeDatabaseClient } from "../db/runtime-db"
import { nextId, now } from "../store/state-support"
import type { ConfigChangeLog, ConfigNamespace, ConfigScopeLevel } from "../types"
import { toConfigChangeLog, type ConfigChangeLogRow } from "./config-row-mappers"

export async function appendConfigChangeLog(input: {
  tenantId: string
  organizationId: string
  projectId?: string
  workspaceId?: string
  businessSessionId?: string
  requestId?: string
  scopeLevel: ConfigScopeLevel
  scopeId: string
  namespace: ConfigNamespace
  configKey: string
  changeType: ConfigChangeLog["changeType"]
  previousVersion?: number
  nextVersion: number
  summaryJson: Record<string, unknown>
  createdBy: string
}) {
  const db = getRuntimeDatabaseClient()
  const createdAt = now()
  await db.execute(
    `
      INSERT INTO config_change_log (
        id,
        tenant_id,
        organization_id,
        project_id,
        workspace_id,
        business_session_id,
        request_id,
        scope_level,
        scope_id,
        namespace,
        config_key,
        change_type,
        previous_version,
        next_version,
        summary_json,
        created_at,
        created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      nextId("cfglog"),
      input.tenantId,
      input.organizationId,
      input.projectId || null,
      input.workspaceId || null,
      input.businessSessionId || null,
      input.requestId || null,
      input.scopeLevel,
      input.scopeId,
      input.namespace,
      input.configKey,
      input.changeType,
      input.previousVersion || null,
      input.nextVersion,
      JSON.stringify(input.summaryJson),
      createdAt,
      input.createdBy,
    ],
  )
}

export async function listConfigChangeLogs(input: {
  tenantId: string
  organizationId: string
  scopeLevel?: ConfigScopeLevel
  scopeId?: string
  namespace?: ConfigNamespace
  limit: number
}) {
  const db = getRuntimeDatabaseClient()
  const filters = [
    "tenant_id = ?",
    "organization_id = ?",
  ]
  const args: Array<string | number> = [input.tenantId, input.organizationId]
  if (input.scopeLevel) {
    filters.push("scope_level = ?")
    args.push(input.scopeLevel)
  }
  if (input.scopeId) {
    filters.push("scope_id = ?")
    args.push(input.scopeId)
  }
  if (input.namespace) {
    filters.push("namespace = ?")
    args.push(input.namespace)
  }
  args.push(input.limit)
  const rows = await db.queryRows<ConfigChangeLogRow>(
    `
      SELECT
        id,
        tenant_id,
        organization_id,
        project_id,
        workspace_id,
        business_session_id,
        request_id,
        scope_level,
        scope_id,
        namespace,
        config_key,
        change_type,
        previous_version,
        next_version,
        summary_json,
        created_at,
        created_by
      FROM config_change_log
      WHERE ${filters.join("\n        AND ")}
      ORDER BY created_at DESC
      LIMIT ?
    `,
    args,
  )
  return rows.map(toConfigChangeLog)
}
