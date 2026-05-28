CREATE TABLE IF NOT EXISTS workspace_share_binding (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  project_id VARCHAR(64) NOT NULL,
  workspace_id VARCHAR(64) NOT NULL,
  owner_user_id VARCHAR(64) NOT NULL,
  target_user_id VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by VARCHAR(64),
  deleted_at TIMESTAMPTZ,
  UNIQUE (workspace_id, target_user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_share_binding_target_user_id
  ON workspace_share_binding (target_user_id, status);

CREATE INDEX IF NOT EXISTS idx_workspace_share_binding_workspace_id
  ON workspace_share_binding (workspace_id, target_user_id);
