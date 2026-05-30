CREATE TABLE IF NOT EXISTS config_item (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  project_id VARCHAR(64),
  workspace_id VARCHAR(64),
  business_session_id VARCHAR(64),
  scope_level VARCHAR(32) NOT NULL,
  scope_id VARCHAR(64) NOT NULL,
  namespace VARCHAR(64) NOT NULL,
  config_key VARCHAR(128) NOT NULL,
  value_json TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by VARCHAR(64) NOT NULL,
  deleted_at TIMESTAMPTZ,
  UNIQUE (scope_level, scope_id, namespace, config_key)
);

CREATE TABLE IF NOT EXISTS config_change_log (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  project_id VARCHAR(64),
  workspace_id VARCHAR(64),
  business_session_id VARCHAR(64),
  request_id VARCHAR(128),
  scope_level VARCHAR(32) NOT NULL,
  scope_id VARCHAR(64) NOT NULL,
  namespace VARCHAR(64) NOT NULL,
  config_key VARCHAR(128) NOT NULL,
  change_type VARCHAR(32) NOT NULL,
  previous_version INTEGER,
  next_version INTEGER NOT NULL,
  summary_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by VARCHAR(64) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_config_item_scope
  ON config_item (tenant_id, organization_id, scope_level, scope_id, namespace);

CREATE INDEX IF NOT EXISTS idx_config_change_log_scope
  ON config_change_log (tenant_id, organization_id, created_at);

