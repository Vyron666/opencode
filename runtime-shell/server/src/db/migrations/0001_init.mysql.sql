CREATE TABLE IF NOT EXISTS tenant (
  id VARCHAR(64) PRIMARY KEY,
  slug VARCHAR(128) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  created_by VARCHAR(64),
  updated_at DATETIME(3) NOT NULL,
  updated_by VARCHAR(64),
  deleted_at DATETIME(3) NULL
);

CREATE TABLE IF NOT EXISTS organization (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  slug VARCHAR(128) NOT NULL,
  name VARCHAR(255) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  created_by VARCHAR(64),
  updated_at DATETIME(3) NOT NULL,
  updated_by VARCHAR(64),
  deleted_at DATETIME(3) NULL,
  UNIQUE KEY uk_organization_scope_slug (tenant_id, slug)
);

CREATE TABLE IF NOT EXISTS project (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  code VARCHAR(128) NOT NULL,
  name VARCHAR(255) NOT NULL,
  default_workspace_path TEXT NULL,
  created_at DATETIME(3) NOT NULL,
  created_by VARCHAR(64),
  updated_at DATETIME(3) NOT NULL,
  updated_by VARCHAR(64),
  deleted_at DATETIME(3) NULL,
  UNIQUE KEY uk_project_scope_code (tenant_id, organization_id, code)
);

CREATE TABLE IF NOT EXISTS user_account (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  username VARCHAR(128) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  role_code VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  created_by VARCHAR(64),
  updated_at DATETIME(3) NOT NULL,
  updated_by VARCHAR(64),
  deleted_at DATETIME(3) NULL,
  UNIQUE KEY uk_user_account_scope_username (tenant_id, organization_id, username)
);

CREATE TABLE IF NOT EXISTS auth_session (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  created_by VARCHAR(64),
  updated_at DATETIME(3) NOT NULL,
  updated_by VARCHAR(64),
  deleted_at DATETIME(3) NULL
);

CREATE TABLE IF NOT EXISTS workspace_binding (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  project_id VARCHAR(64) NOT NULL,
  workspace_code VARCHAR(128) NOT NULL,
  name VARCHAR(255) NOT NULL,
  root_path TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  updated_by VARCHAR(64),
  deleted_at DATETIME(3) NULL,
  UNIQUE KEY uk_workspace_binding_scope_code (tenant_id, organization_id, project_id, workspace_code),
  UNIQUE KEY uk_workspace_binding_scope_root_path (tenant_id, organization_id, project_id, root_path(255))
);

CREATE TABLE IF NOT EXISTS worker_node (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NULL,
  organization_id VARCHAR(64) NULL,
  worker_code VARCHAR(128) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  base_url TEXT NOT NULL,
  status VARCHAR(32) NOT NULL,
  capacity INT NOT NULL,
  active_session_count INT NOT NULL DEFAULT 0,
  last_heartbeat_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  created_by VARCHAR(64),
  updated_at DATETIME(3) NOT NULL,
  updated_by VARCHAR(64),
  deleted_at DATETIME(3) NULL
);

CREATE TABLE IF NOT EXISTS business_session (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  project_id VARCHAR(64) NOT NULL,
  workspace_binding_id VARCHAR(64) NOT NULL,
  worker_node_id VARCHAR(64) NULL,
  title VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  workspace_path TEXT NOT NULL,
  last_event_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  updated_by VARCHAR(64),
  deleted_at DATETIME(3) NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  project_id VARCHAR(64) NULL,
  user_id VARCHAR(64) NULL,
  business_session_id VARCHAR(64) NULL,
  request_id VARCHAR(128) NULL,
  action VARCHAR(128) NOT NULL,
  resource_type VARCHAR(128) NOT NULL,
  resource_id VARCHAR(64) NULL,
  detail_json LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  created_by VARCHAR(64)
);

CREATE INDEX idx_organization_tenant_id ON organization (tenant_id);
CREATE INDEX idx_project_scope ON project (tenant_id, organization_id);
CREATE INDEX idx_user_account_scope ON user_account (tenant_id, organization_id);
CREATE INDEX idx_auth_session_user_id ON auth_session (user_id);
CREATE INDEX idx_auth_session_expires_at ON auth_session (expires_at);
CREATE INDEX idx_workspace_binding_scope ON workspace_binding (tenant_id, organization_id, project_id);
CREATE INDEX idx_worker_node_status ON worker_node (status);
CREATE INDEX idx_business_session_scope ON business_session (tenant_id, organization_id, project_id);
CREATE INDEX idx_business_session_worker_node_id ON business_session (worker_node_id);
CREATE INDEX idx_audit_log_scope ON audit_log (tenant_id, organization_id, created_at);
