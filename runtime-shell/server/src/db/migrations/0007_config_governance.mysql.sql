CREATE TABLE IF NOT EXISTS config_item (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  project_id VARCHAR(64) NULL,
  workspace_id VARCHAR(64) NULL,
  business_session_id VARCHAR(64) NULL,
  scope_level VARCHAR(32) NOT NULL,
  scope_id VARCHAR(64) NOT NULL,
  namespace VARCHAR(64) NOT NULL,
  config_key VARCHAR(128) NOT NULL,
  value_json LONGTEXT NOT NULL,
  version INT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  updated_by VARCHAR(64) NOT NULL,
  deleted_at DATETIME(3) NULL,
  UNIQUE KEY uk_config_item_scope_namespace_key (scope_level, scope_id, namespace, config_key)
);

CREATE TABLE IF NOT EXISTS config_change_log (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  project_id VARCHAR(64) NULL,
  workspace_id VARCHAR(64) NULL,
  business_session_id VARCHAR(64) NULL,
  request_id VARCHAR(128) NULL,
  scope_level VARCHAR(32) NOT NULL,
  scope_id VARCHAR(64) NOT NULL,
  namespace VARCHAR(64) NOT NULL,
  config_key VARCHAR(128) NOT NULL,
  change_type VARCHAR(32) NOT NULL,
  previous_version INT NULL,
  next_version INT NOT NULL,
  summary_json LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  created_by VARCHAR(64) NOT NULL
);

CREATE INDEX idx_config_item_scope
  ON config_item (tenant_id, organization_id, scope_level, scope_id, namespace);

CREATE INDEX idx_config_change_log_scope
  ON config_change_log (tenant_id, organization_id, created_at);

