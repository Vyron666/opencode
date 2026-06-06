ALTER TABLE worker_node
  ADD COLUMN IF NOT EXISTS resource_summary_json TEXT,
  ADD COLUMN IF NOT EXISTS warm_pool_target INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS warm_pool_ready INTEGER NOT NULL DEFAULT 0;

ALTER TABLE worker_heartbeat
  ADD COLUMN IF NOT EXISTS resource_summary_json TEXT;

CREATE TABLE IF NOT EXISTS sandbox_instance (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  project_id VARCHAR(64) NOT NULL,
  workspace_id VARCHAR(64) NOT NULL,
  business_session_id VARCHAR(64) NOT NULL,
  worker_node_id VARCHAR(64) NOT NULL,
  backend VARCHAR(32) NOT NULL,
  runtime_class VARCHAR(128),
  isolation_mode VARCHAR(64),
  status VARCHAR(32) NOT NULL,
  sandbox_path TEXT NOT NULL,
  detail_json TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sandbox_instance_workspace
  ON sandbox_instance (workspace_id);

CREATE INDEX IF NOT EXISTS idx_sandbox_instance_session
  ON sandbox_instance (business_session_id);

CREATE INDEX IF NOT EXISTS idx_sandbox_instance_worker_status
  ON sandbox_instance (worker_node_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_sandbox_instance_updated
  ON sandbox_instance (updated_at DESC);

CREATE TABLE IF NOT EXISTS runtime_operation_queue (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  project_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  business_session_id VARCHAR(64),
  worker_node_id VARCHAR(64),
  operation_type VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  idempotency_key VARCHAR(128),
  detail_json TEXT NOT NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_runtime_operation_queue_scope_status
  ON runtime_operation_queue (tenant_id, organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_runtime_operation_queue_created
  ON runtime_operation_queue (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_runtime_operation_queue_stale
  ON runtime_operation_queue (status, updated_at, started_at);

CREATE INDEX IF NOT EXISTS idx_runtime_operation_queue_session
  ON runtime_operation_queue (business_session_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_operation_queue_idempotency
  ON runtime_operation_queue (business_session_id, operation_type, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS quota_policy (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  scope_type VARCHAR(32) NOT NULL,
  scope_id VARCHAR(64) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  max_active_sessions INTEGER,
  max_queued_operations INTEGER,
  max_running_sandboxes INTEGER,
  max_warm_pool_per_worker INTEGER,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by VARCHAR(64) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_quota_policy_scope
  ON quota_policy (tenant_id, organization_id, scope_type, scope_id);
