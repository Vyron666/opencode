CREATE TABLE IF NOT EXISTS business_session_runtime_binding (
  id VARCHAR(64) PRIMARY KEY,
  business_session_id VARCHAR(64) NOT NULL,
  worker_node_id VARCHAR(64) NOT NULL,
  acp_session_id VARCHAR(128),
  runtime_key VARCHAR(128),
  binding_status VARCHAR(32) NOT NULL,
  bound_at TIMESTAMPTZ NOT NULL,
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_runtime_binding_session_id
  ON business_session_runtime_binding (business_session_id);

CREATE INDEX IF NOT EXISTS idx_session_runtime_binding_worker_status
  ON business_session_runtime_binding (worker_node_id, binding_status);

CREATE INDEX IF NOT EXISTS idx_session_runtime_binding_session_status_updated
  ON business_session_runtime_binding (business_session_id, binding_status, updated_at DESC);
