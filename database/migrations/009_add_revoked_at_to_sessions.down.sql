-- Rollback: 009_add_revoked_at_to_sessions
ALTER TABLE sessions DROP COLUMN IF EXISTS revoked_at;
