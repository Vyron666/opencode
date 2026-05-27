ALTER TABLE business_session
  ADD COLUMN IF NOT EXISTS binding_json TEXT,
  ADD COLUMN IF NOT EXISTS capability_state_json TEXT NOT NULL DEFAULT '{}';
