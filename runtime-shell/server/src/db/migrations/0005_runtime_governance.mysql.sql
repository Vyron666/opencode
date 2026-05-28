CREATE TABLE IF NOT EXISTS worker_heartbeat (
  id VARCHAR(64) PRIMARY KEY,
  worker_node_id VARCHAR(64) NOT NULL,
  capacity_used INT NOT NULL,
  status VARCHAR(32) NOT NULL,
  reported_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS runtime_lease (
  id VARCHAR(64) PRIMARY KEY,
  business_session_id VARCHAR(64) NOT NULL,
  worker_node_id VARCHAR(64) NOT NULL,
  lease_owner VARCHAR(128) NOT NULL,
  lease_expires_at DATETIME(3) NOT NULL,
  version INT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_runtime_lease_session_id (business_session_id)
);

CREATE TABLE IF NOT EXISTS runtime_failure_log (
  id VARCHAR(64) PRIMARY KEY,
  business_session_id VARCHAR(64) NULL,
  worker_node_id VARCHAR(64) NULL,
  failure_type VARCHAR(32) NOT NULL,
  message TEXT NULL,
  detail_json LONGTEXT NULL,
  created_at DATETIME(3) NOT NULL
);

CREATE INDEX idx_worker_heartbeat_worker_reported_at
  ON worker_heartbeat (worker_node_id, reported_at);

CREATE INDEX idx_runtime_lease_worker_expires_at
  ON runtime_lease (worker_node_id, lease_expires_at);

CREATE INDEX idx_runtime_failure_log_session_created_at
  ON runtime_failure_log (business_session_id, created_at);
