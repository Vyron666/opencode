CREATE TABLE IF NOT EXISTS tenant (
  id VARCHAR(64) PRIMARY KEY,
  slug VARCHAR(128) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by VARCHAR(64),
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by VARCHAR(64),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS organization (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  slug VARCHAR(128) NOT NULL,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by VARCHAR(64),
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by VARCHAR(64),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, slug)
);

CREATE TABLE IF NOT EXISTS project (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  code VARCHAR(128) NOT NULL,
  name VARCHAR(255) NOT NULL,
  default_workspace_path TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  created_by VARCHAR(64),
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by VARCHAR(64),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, organization_id, code)
);

CREATE TABLE IF NOT EXISTS user_account (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  username VARCHAR(128) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  role_code VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by VARCHAR(64),
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by VARCHAR(64),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, organization_id, username)
);

CREATE TABLE IF NOT EXISTS auth_session (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  status VARCHAR(32) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by VARCHAR(64),
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by VARCHAR(64),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS workspace_binding (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  project_id VARCHAR(64) NOT NULL,
  workspace_code VARCHAR(128) NOT NULL,
  name VARCHAR(255) NOT NULL,
  root_path TEXT NOT NULL,
  status VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by VARCHAR(64),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, organization_id, project_id, workspace_code),
  UNIQUE (tenant_id, organization_id, project_id, root_path)
);

CREATE TABLE IF NOT EXISTS worker_node (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64),
  organization_id VARCHAR(64),
  worker_code VARCHAR(128) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  base_url TEXT NOT NULL,
  status VARCHAR(32) NOT NULL,
  capacity INTEGER NOT NULL,
  active_session_count INTEGER NOT NULL DEFAULT 0,
  last_heartbeat_at TIMESTAMPTZ NOT NULL,
  version VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL,
  created_by VARCHAR(64),
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by VARCHAR(64),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS business_session (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  project_id VARCHAR(64) NOT NULL,
  workspace_binding_id VARCHAR(64) NOT NULL,
  worker_node_id VARCHAR(64),
  title VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  workspace_path TEXT NOT NULL,
  last_event_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by VARCHAR(64),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS session_share_binding (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  project_id VARCHAR(64) NOT NULL,
  workspace_id VARCHAR(64) NOT NULL,
  business_session_id VARCHAR(64) NOT NULL,
  owner_user_id VARCHAR(64) NOT NULL,
  target_user_id VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by VARCHAR(64),
  deleted_at TIMESTAMPTZ,
  UNIQUE (business_session_id, target_user_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  project_id VARCHAR(64),
  user_id VARCHAR(64),
  business_session_id VARCHAR(64),
  request_id VARCHAR(128),
  action VARCHAR(128) NOT NULL,
  resource_type VARCHAR(128) NOT NULL,
  resource_id VARCHAR(64),
  detail_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by VARCHAR(64)
);

CREATE INDEX IF NOT EXISTS idx_organization_tenant_id ON organization (tenant_id);
CREATE INDEX IF NOT EXISTS idx_project_scope ON project (tenant_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_user_account_scope ON user_account (tenant_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_auth_session_user_id ON auth_session (user_id);
CREATE INDEX IF NOT EXISTS idx_auth_session_expires_at ON auth_session (expires_at);
CREATE INDEX IF NOT EXISTS idx_workspace_binding_scope ON workspace_binding (tenant_id, organization_id, project_id);
CREATE INDEX IF NOT EXISTS idx_worker_node_status ON worker_node (status);
CREATE INDEX IF NOT EXISTS idx_business_session_scope ON business_session (tenant_id, organization_id, project_id);
CREATE INDEX IF NOT EXISTS idx_business_session_worker_node_id ON business_session (worker_node_id);
CREATE INDEX IF NOT EXISTS idx_session_share_binding_target_user_id ON session_share_binding (target_user_id, status);
CREATE INDEX IF NOT EXISTS idx_session_share_binding_workspace_id ON session_share_binding (workspace_id, target_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_scope ON audit_log (tenant_id, organization_id, created_at);
