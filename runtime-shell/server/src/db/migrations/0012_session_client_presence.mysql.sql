ALTER TABLE business_session
  ADD COLUMN client_connected_count INT NOT NULL DEFAULT 0,
  ADD COLUMN last_client_seen_at DATETIME(3) NULL,
  ADD COLUMN last_client_disconnected_at DATETIME(3) NULL;

CREATE INDEX idx_business_session_client_presence
  ON business_session (status, client_connected_count, last_client_seen_at);
