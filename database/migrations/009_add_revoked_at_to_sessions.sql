-- Migration: 009_add_revoked_at_to_sessions
-- Description: Adds revoked_at timestamp column to sessions table for audit precision

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
