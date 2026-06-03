CREATE INDEX IF NOT EXISTS idx_audit_log_session_created
  ON audit_log (business_session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_request_id
  ON audit_log (request_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_action_created
  ON audit_log (action, created_at DESC);
