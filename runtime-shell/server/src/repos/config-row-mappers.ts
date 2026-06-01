import type { ConfigChangeLog, ConfigItem, ConfigNamespace, ConfigScopeLevel } from "../types"

export type ConfigItemRow = {
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

export type ConfigChangeLogRow = {
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

export function toConfigItem(row: ConfigItemRow): ConfigItem {
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

export function toConfigChangeLog(row: ConfigChangeLogRow): ConfigChangeLog {
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

function safeParseJson(raw: string) {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
