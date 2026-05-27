ALTER TABLE auth_session
  ADD COLUMN IF NOT EXISTS status VARCHAR(32) NULL;

UPDATE auth_session
SET status = CASE
  WHEN expires_at <= CURRENT_TIMESTAMP(3) THEN 'expired'
  ELSE 'active'
END
WHERE status IS NULL;

ALTER TABLE auth_session
  MODIFY COLUMN status VARCHAR(32) NOT NULL;

ALTER TABLE workspace_binding
  ADD COLUMN IF NOT EXISTS status VARCHAR(32) NULL;

UPDATE workspace_binding
SET status = 'active'
WHERE status IS NULL;

ALTER TABLE workspace_binding
  MODIFY COLUMN status VARCHAR(32) NOT NULL;
