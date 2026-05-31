import { getRuntimeDatabaseClient } from "../db/runtime-db"
import { nextId, now } from "../store/state-support"
import type { ConfigChangeLog, ConfigItem, ConfigNamespace, ConfigScopeLevel } from "../types"

type ConfigItemRow = {
  id: string
  tenant_id: string
  organization_id: string
  project_id: string | null
  workspace_id: string | null
  business_session_id: string | null
  scope_level: ConfigScopeLevel
  scope_id: string
  namespace: ConfigNamespace
  config_key: string
  value_json: string
  version: number
  created_at: string
  created_by: string
  updated_at: string
  updated_by: string
}

type ConfigChangeLogRow = {
  id: string
  tenant_id: string
  organization_id: string
  project_id: string | null
  workspace_id: string | null
  business_session_id: string | null
  request_id: string | null
  scope_level: ConfigScopeLevel
  scope_id: string
  namespace: ConfigNamespace
  config_key: string
  change_type: ConfigChangeLog["changeType"]
  previous_version: number | null
  next_version: number
  summary_json: string
  created_at: string
  created_by: string
}

function toConfigItem(row: ConfigItemRow): ConfigItem {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    organizationId: row.organization_id,
    projectId: row.project_id || undefined,
    workspaceId: row.workspace_id || undefined,
    businessSessionId: row.business_session_id || undefined,
    scopeLevel: row.scope_level,
    scopeId: row.scope_id,
    namespace: row.namespace,
    configKey: row.config_key,
    valueJson: safeParseJson(row.value_json),
    version: Number(row.version),
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }
}

function toConfigChangeLog(row: ConfigChangeLogRow): ConfigChangeLog {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    organizationId: row.organization_id,
    projectId: row.project_id || undefined,
    workspaceId: row.workspace_id || undefined,
    businessSessionId: row.business_session_id || undefined,
    requestId: row.request_id || undefined,
    scopeLevel: row.scope_level,
    scopeId: row.scope_id,
    namespace: row.namespace,
    configKey: row.config_key,
    changeType: row.change_type,
    previousVersion: row.previous_version ?? undefined,
    nextVersion: Number(row.next_version),
    summaryJson: safeParseJson(row.summary_json) ?? {},
    createdAt: row.created_at,
    createdBy: row.created_by,
  }
}

export async function findConfigItem(input: {
  scopeLevel: ConfigScopeLevel
  scopeId: string
  namespace: ConfigNamespace
  configKey: string
}) {
  const db = getRuntimeDatabaseClient()
  const row = await db.queryFirst<ConfigItemRow>(
    `
      SELECT
        id,
        tenant_id,
        organization_id,
        project_id,
        workspace_id,
        business_session_id,
        scope_level,
        scope_id,
        namespace,
        config_key,
        value_json,
        version,
        created_at,
        created_by,
        updated_at,
        updated_by
      FROM config_item
      WHERE scope_level = ?
        AND scope_id = ?
        AND namespace = ?
        AND config_key = ?
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [input.scopeLevel, input.scopeId, input.namespace, input.configKey],
  )
  if (!row) return
  return toConfigItem(row)
}

export async function listConfigItems(input: {
  tenantId: string
  organizationId: string
  scopeLevel: ConfigScopeLevel
  scopeId: string
  namespace: ConfigNamespace
}) {
  const db = getRuntimeDatabaseClient()
  const rows = await db.queryRows<ConfigItemRow>(
    `
      SELECT
        id,
        tenant_id,
        organization_id,
        project_id,
        workspace_id,
        business_session_id,
        scope_level,
        scope_id,
        namespace,
        config_key,
        value_json,
        version,
        created_at,
        created_by,
        updated_at,
        updated_by
      FROM config_item
      WHERE tenant_id = ?
        AND organization_id = ?
        AND scope_level = ?
        AND scope_id = ?
        AND namespace = ?
        AND deleted_at IS NULL
      ORDER BY config_key ASC
    `,
    [input.tenantId, input.organizationId, input.scopeLevel, input.scopeId, input.namespace],
  )
  return rows.map(toConfigItem)
}

export async function upsertConfigItem(input: {
  tenantId: string
  organizationId: string
  projectId?: string
  workspaceId?: string
  businessSessionId?: string
  scopeLevel: ConfigScopeLevel
  scopeId: string
  namespace: ConfigNamespace
  configKey: string
  valueJson: unknown
  updatedBy: string
}) {
  const db = getRuntimeDatabaseClient()
  const existing = await findConfigItem({
    scopeLevel: input.scopeLevel,
    scopeId: input.scopeId,
    namespace: input.namespace,
    configKey: input.configKey,
  })
  const timestamp = now()
  const nextVersion = (existing?.version || 0) + 1
  const serialized = JSON.stringify(input.valueJson)

  if (existing) {
    await db.execute(
      `
        UPDATE config_item
        SET
          tenant_id = ?,
          organization_id = ?,
          project_id = ?,
          workspace_id = ?,
          business_session_id = ?,
          value_json = ?,
          version = ?,
          updated_at = ?,
          updated_by = ?
        WHERE id = ?
      `,
      [
        input.tenantId,
        input.organizationId,
        input.projectId || null,
        input.workspaceId || null,
        input.businessSessionId || null,
        serialized,
        nextVersion,
        timestamp,
        input.updatedBy,
        existing.id,
      ],
    )
    return {
      previous: existing,
      current: {
        ...existing,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        businessSessionId: input.businessSessionId,
        valueJson: input.valueJson,
        version: nextVersion,
        updatedAt: timestamp,
        updatedBy: input.updatedBy,
      } satisfies ConfigItem,
    }
  }

  const created: ConfigItem = {
    id: nextId("cfg"),
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    businessSessionId: input.businessSessionId,
    scopeLevel: input.scopeLevel,
    scopeId: input.scopeId,
    namespace: input.namespace,
    configKey: input.configKey,
    valueJson: input.valueJson,
    version: nextVersion,
    createdAt: timestamp,
    createdBy: input.updatedBy,
    updatedAt: timestamp,
    updatedBy: input.updatedBy,
  }
  await db.execute(
    `
      INSERT INTO config_item (
        id,
        tenant_id,
        organization_id,
        project_id,
        workspace_id,
        business_session_id,
        scope_level,
        scope_id,
        namespace,
        config_key,
        value_json,
        version,
        created_at,
        created_by,
        updated_at,
        updated_by,
        deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      created.id,
      created.tenantId,
      created.organizationId,
      created.projectId || null,
      created.workspaceId || null,
      created.businessSessionId || null,
      created.scopeLevel,
      created.scopeId,
      created.namespace,
      created.configKey,
      serialized,
      created.version,
      created.createdAt,
      created.createdBy,
      created.updatedAt,
      created.updatedBy,
      null,
    ],
  )
  return {
    previous: undefined,
    current: created,
  }
}

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

function safeParseJson(raw: string) {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
