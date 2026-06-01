import type { BusinessSession } from "../types"

export type SessionRow = {
  id: string
  tenant_id: string
  organization_id: string
  project_id: string
  workspace_binding_id: string
  worker_node_id: string | null
  title: string
  status: BusinessSession["status"]
  created_by: string
  workspace_path: string
  last_event_at: string | null
  created_at: string
  updated_at: string
  binding_json: string | null
  capability_state_json: string | null
}

export function parseJson<T>(value: string | null | undefined): T | undefined {
  if (!value) return
  return JSON.parse(value) as T
}

export function toBusinessSession(row: SessionRow): BusinessSession {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_binding_id,
    title: row.title,
    projectId: row.project_id,
    workspacePath: row.workspace_path,
    workerId: row.worker_node_id || "",
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastEventAt: row.last_event_at || undefined,
    binding: parseJson(row.binding_json),
    capabilityState: parseJson(row.capability_state_json) || {},
  }
}

export function stringifySessionJson(value: unknown) {
  return JSON.stringify(value ?? {})
}
