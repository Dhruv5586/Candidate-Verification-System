-- Migration: 016_alter_verifications_phase9
-- Description: Adds workflow priority, assigned timestamp, and reviewer tracking to verifications table

ALTER TABLE verifications
    ADD COLUMN IF NOT EXISTS priority VARCHAR(20) NOT NULL DEFAULT 'normal'
        CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_verifications_priority ON verifications(priority);
CREATE INDEX IF NOT EXISTS idx_verifications_assigned_at ON verifications(assigned_at);
