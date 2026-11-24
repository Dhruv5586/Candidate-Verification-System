-- Migration: 016_alter_verifications_phase9 (Down)
DROP INDEX IF EXISTS idx_verifications_priority;
DROP INDEX IF EXISTS idx_verifications_assigned_at;
ALTER TABLE verifications 
    DROP COLUMN IF EXISTS priority,
    DROP COLUMN IF EXISTS assigned_at;
