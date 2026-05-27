ALTER TABLE auth_session
  ADD COLUMN IF NOT EXISTS status VARCHAR(32);

UPDATE auth_session
SET status = CASE
  WHEN expires_at <= NOW() THEN 'expired'
  ELSE 'active'
END
WHERE status IS NULL;

ALTER TABLE auth_session
  ALTER COLUMN status SET NOT NULL;

ALTER TABLE workspace_binding
  ADD COLUMN IF NOT EXISTS status VARCHAR(32);

UPDATE workspace_binding
SET status = 'active'
WHERE status IS NULL;

ALTER TABLE workspace_binding
  ALTER COLUMN status SET NOT NULL;
