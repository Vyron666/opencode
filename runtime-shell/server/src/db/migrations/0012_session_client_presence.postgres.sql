ALTER TABLE business_session
  ADD COLUMN IF NOT EXISTS client_connected_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_client_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_client_disconnected_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_business_session_client_presence
  ON business_session (status, client_connected_count, last_client_seen_at DESC);
