export type Workspace = {
  id: string
  tenantId: string
  organizationId: string
  projectId: string
  name: string
  rootPath: string
  status: "active" | "disabled" | "deleted"
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type WorkspaceShareBinding = {
  id: string
  tenantId: string
  organizationId: string
  projectId: string
  workspaceId: string
  ownerUserId: string
  targetUserId: string
  status: "active" | "revoked"
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

export type WorkspaceAccessResult =
  | {
      ok: true
      workspace: Workspace
    }
  | {
      ok: false
      reason:
        | "workspace_not_found"
        | "forbidden"
        | "workspace_disabled"
        | "invalid_path"
        | "scope_mismatch"
        | "workspace_not_shared"
        | "share_revoked"
    }

export type WorkspaceCreationResult =
  | {
      ok: true
      workspace: Workspace
    }
  | {
      ok: false
      reason: "forbidden" | "invalid_name" | "project_out_of_scope" | "create_failed"
    }
