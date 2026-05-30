CREATE TABLE IF NOT EXISTS config_approval_request (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  request_id VARCHAR(128) NULL,
  namespace VARCHAR(32) NOT NULL,
  config_key VARCHAR(255) NOT NULL,
  scope_level VARCHAR(32) NOT NULL,
  scope_id VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL,
  summary_json TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  reviewed_at TIMESTAMP NULL,
  reviewed_by VARCHAR(64) NULL,
  review_comment TEXT NULL
);

CREATE INDEX idx_config_approval_request_scope
  ON config_approval_request (tenant_id, organization_id, status, created_at);
