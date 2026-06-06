CREATE TABLE IF NOT EXISTS worker_heartbeat (
  id VARCHAR(64) PRIMARY KEY,
  worker_node_id VARCHAR(64) NOT NULL,
  capacity_used INTEGER NOT NULL,
  status VARCHAR(32) NOT NULL,
  reported_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS runtime_lease (
  id VARCHAR(64) PRIMARY KEY,
  business_session_id VARCHAR(64) NOT NULL UNIQUE,
  worker_node_id VARCHAR(64) NOT NULL,
  lease_owner VARCHAR(128) NOT NULL,
  lease_expires_at TIMESTAMPTZ NOT NULL,
  version INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS runtime_failure_log (
  id VARCHAR(64) PRIMARY KEY,
  business_session_id VARCHAR(64),
  worker_node_id VARCHAR(64),
  failure_type VARCHAR(32) NOT NULL,
  message TEXT,
  detail_json TEXT,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_worker_heartbeat_worker_reported_at
  ON worker_heartbeat (worker_node_id, reported_at);

CREATE INDEX IF NOT EXISTS idx_worker_heartbeat_worker_reported_desc
  ON worker_heartbeat (worker_node_id, reported_at DESC);

CREATE INDEX IF NOT EXISTS idx_runtime_lease_worker_expires_at
  ON runtime_lease (worker_node_id, lease_expires_at);

CREATE INDEX IF NOT EXISTS idx_runtime_failure_log_session_created_at
  ON runtime_failure_log (business_session_id, created_at);
