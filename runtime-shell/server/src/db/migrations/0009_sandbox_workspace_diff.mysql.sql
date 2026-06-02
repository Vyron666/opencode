CREATE TABLE IF NOT EXISTS sandbox_workspace (
  id VARCHAR(64) PRIMARY KEY,
  business_session_id VARCHAR(64) NOT NULL,
  workspace_id VARCHAR(64) NOT NULL,
  workspace_path TEXT NOT NULL,
  sandbox_path TEXT NOT NULL,
  status VARCHAR(32) NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  expires_at TIMESTAMP NULL,
  closed_at TIMESTAMP NULL
);

CREATE UNIQUE INDEX idx_sandbox_workspace_session
  ON sandbox_workspace (business_session_id);

CREATE INDEX idx_sandbox_workspace_status
  ON sandbox_workspace (status, updated_at);

CREATE TABLE IF NOT EXISTS sandbox_diff (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  project_id VARCHAR(64) NOT NULL,
  workspace_id VARCHAR(64) NOT NULL,
  business_session_id VARCHAR(64) NOT NULL,
  sandbox_workspace_id VARCHAR(64) NOT NULL,
  workspace_mode VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  summary_json TEXT NOT NULL,
  artifact_uri TEXT NULL,
  policy_result_json TEXT NOT NULL,
  idempotency_key VARCHAR(128) NULL,
  created_by VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  applied_at TIMESTAMP NULL,
  rejected_at TIMESTAMP NULL,
  expires_at TIMESTAMP NULL
);

CREATE INDEX idx_sandbox_diff_session
  ON sandbox_diff (business_session_id, created_at);

CREATE UNIQUE INDEX idx_sandbox_diff_idempotency
  ON sandbox_diff (business_session_id, idempotency_key);
