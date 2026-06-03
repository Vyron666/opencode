ALTER TABLE worker_node
  ADD COLUMN IF NOT EXISTS resource_summary_json TEXT NULL,
  ADD COLUMN IF NOT EXISTS warm_pool_target INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS warm_pool_ready INTEGER NOT NULL DEFAULT 0;

ALTER TABLE worker_heartbeat
  ADD COLUMN IF NOT EXISTS resource_summary_json TEXT NULL;

CREATE TABLE IF NOT EXISTS sandbox_instance (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  project_id VARCHAR(64) NOT NULL,
  workspace_id VARCHAR(64) NOT NULL,
  business_session_id VARCHAR(64) NOT NULL,
  worker_node_id VARCHAR(64) NOT NULL,
  backend VARCHAR(32) NOT NULL,
  runtime_class VARCHAR(128) NULL,
  isolation_mode VARCHAR(64) NULL,
  status VARCHAR(32) NOT NULL,
  sandbox_path TEXT NOT NULL,
  detail_json TEXT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  opened_at DATETIME(3) NULL,
  closed_at DATETIME(3) NULL
);

CREATE UNIQUE INDEX idx_sandbox_instance_workspace
  ON sandbox_instance (workspace_id);

CREATE INDEX idx_sandbox_instance_session
  ON sandbox_instance (business_session_id);

CREATE INDEX idx_sandbox_instance_worker_status
  ON sandbox_instance (worker_node_id, status, updated_at);

CREATE TABLE IF NOT EXISTS runtime_operation_queue (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  project_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  business_session_id VARCHAR(64) NULL,
  worker_node_id VARCHAR(64) NULL,
  operation_type VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  idempotency_key VARCHAR(128) NULL,
  detail_json TEXT NOT NULL,
  error_message TEXT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  started_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL
);

CREATE INDEX idx_runtime_operation_queue_scope_status
  ON runtime_operation_queue (tenant_id, organization_id, status, created_at);

CREATE INDEX idx_runtime_operation_queue_session
  ON runtime_operation_queue (business_session_id, created_at);

CREATE UNIQUE INDEX idx_runtime_operation_queue_idempotency
  ON runtime_operation_queue (business_session_id, operation_type, idempotency_key);

CREATE TABLE IF NOT EXISTS quota_policy (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  scope_type VARCHAR(32) NOT NULL,
  scope_id VARCHAR(64) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  max_active_sessions INTEGER NULL,
  max_queued_operations INTEGER NULL,
  max_running_sandboxes INTEGER NULL,
  max_warm_pool_per_worker INTEGER NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  updated_by VARCHAR(64) NOT NULL
);

CREATE UNIQUE INDEX idx_quota_policy_scope
  ON quota_policy (tenant_id, organization_id, scope_type, scope_id);
