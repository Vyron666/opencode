CREATE INDEX idx_audit_log_session_created
  ON audit_log (business_session_id, created_at);

CREATE INDEX idx_audit_log_request_id
  ON audit_log (request_id);

CREATE INDEX idx_audit_log_action_created
  ON audit_log (action, created_at);
