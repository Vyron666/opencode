import { getRuntimeDatabaseClient } from "../db/runtime-db"
import { nextId, now } from "../store/state-support"
import type { ConfigItem, ConfigNamespace, ConfigScopeLevel } from "../types"
import { toConfigItem, type ConfigItemRow } from "./config-row-mappers"

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
