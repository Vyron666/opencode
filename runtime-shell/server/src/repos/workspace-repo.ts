import path from "node:path"
import { getRuntimeDatabaseClient } from "../db/runtime-db"
import { nextId, now } from "../store/state-support"
import type { User, Workspace } from "../types"

type WorkspaceRow = {
  id: string
  tenant_id: string
  organization_id: string
  project_id: string
  name: string
  root_path: string
  status: "active" | "disabled" | "deleted"
  created_by: string
  created_at: string
  updated_at: string
}

function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    name: row.name,
    rootPath: row.root_path,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listAllWorkspaces() {
  const db = getRuntimeDatabaseClient()
  const rows = await db.queryRows<WorkspaceRow>(
    `
      SELECT
        id,
        tenant_id,
        organization_id,
        project_id,
        name,
        root_path,
        status,
        created_by,
        created_at,
        updated_at
      FROM workspace_binding
      WHERE deleted_at IS NULL
      ORDER BY created_at ASC
    `,
  )
  return rows.map(toWorkspace)
}

export async function findWorkspace(workspaceId: string) {
  const db = getRuntimeDatabaseClient()
  const row = await db.queryFirst<WorkspaceRow>(
    `
      SELECT
        id,
        tenant_id,
        organization_id,
        project_id,
        name,
        root_path,
        status,
        created_by,
        created_at,
        updated_at
      FROM workspace_binding
      WHERE id = ?
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [workspaceId],
  )
  if (!row) return
  return toWorkspace(row)
}

export async function findWorkspaceByPath(rootPath: string) {
  const db = getRuntimeDatabaseClient()
  const row = await db.queryFirst<WorkspaceRow>(
    `
      SELECT
        id,
        tenant_id,
        organization_id,
        project_id,
        name,
        root_path,
        status,
        created_by,
        created_at,
        updated_at
      FROM workspace_binding
      WHERE root_path = ?
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [rootPath],
  )
  if (!row) return
  return toWorkspace(row)
}

export async function listWorkspacesForUser(user: User) {
  const db = getRuntimeDatabaseClient()
  const rows = await db.queryRows<WorkspaceRow>(
    `
      SELECT
        id,
        tenant_id,
        organization_id,
        project_id,
        name,
        root_path,
        status,
        created_by,
        created_at,
        updated_at
      FROM workspace_binding
      WHERE tenant_id = ?
        AND organization_id = ?
        AND deleted_at IS NULL
      ORDER BY created_at ASC
    `,
    [user.tenantId, user.organizationId],
  )
  return rows.map(toWorkspace)
}

export async function ensureWorkspace(input: {
  tenantId: string
  organizationId: string
  projectId: string
  rootPath: string
  createdBy: string
  name?: string
}) {
  const existing = await findWorkspaceByPath(input.rootPath)
  if (existing) return existing
  const db = getRuntimeDatabaseClient()
  const timestamp = now()
  const workspace: Workspace = {
    id: nextId("workspace"),
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    projectId: input.projectId,
    name: input.name || path.basename(input.rootPath) || input.projectId,
    rootPath: input.rootPath,
    status: "active",
    createdBy: input.createdBy,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  await db.execute(
    `
      INSERT INTO workspace_binding (
        id,
        tenant_id,
        organization_id,
        project_id,
        workspace_code,
        name,
        root_path,
        status,
        created_at,
        created_by,
        updated_at,
        updated_by,
        deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      workspace.id,
      workspace.tenantId,
      workspace.organizationId,
      workspace.projectId,
      workspace.id,
      workspace.name,
      workspace.rootPath,
      workspace.status,
      workspace.createdAt,
      workspace.createdBy,
      workspace.updatedAt,
      workspace.createdBy,
      null,
    ],
  )
  return workspace
}
