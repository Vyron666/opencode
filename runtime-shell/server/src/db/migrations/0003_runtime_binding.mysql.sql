CREATE TABLE IF NOT EXISTS business_session_runtime_binding (
  id VARCHAR(64) PRIMARY KEY,
  business_session_id VARCHAR(64) NOT NULL,
  worker_node_id VARCHAR(64) NOT NULL,
  acp_session_id VARCHAR(128) NULL,
  runtime_key VARCHAR(128) NULL,
  binding_status VARCHAR(32) NOT NULL,
  bound_at DATETIME(3) NOT NULL,
  released_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL
);

CREATE INDEX idx_session_runtime_binding_session_id
  ON business_session_runtime_binding (business_session_id);

CREATE INDEX idx_session_runtime_binding_worker_status
  ON business_session_runtime_binding (worker_node_id, binding_status);
