CREATE TABLE IF NOT EXISTS sandbox_workspace (
  id VARCHAR(64) PRIMARY KEY,
  business_session_id VARCHAR(64) NOT NULL,
  workspace_id VARCHAR(64) NOT NULL,
  workspace_path TEXT NOT NULL,
  sandbox_path TEXT NOT NULL,
  status VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sandbox_workspace_workspace
  ON sandbox_workspace (workspace_id);

CREATE INDEX IF NOT EXISTS idx_sandbox_workspace_session
  ON sandbox_workspace (business_session_id);

CREATE INDEX IF NOT EXISTS idx_sandbox_workspace_status
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
  artifact_uri TEXT,
  policy_result_json TEXT NOT NULL,
  idempotency_key VARCHAR(128),
  created_by VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  applied_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sandbox_diff_session
  ON sandbox_diff (business_session_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sandbox_diff_idempotency
  ON sandbox_diff (business_session_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
