-- Migration: 010_alter_candidates_phase8
-- Description: Enhances candidates table with full_name, location, current_job_title, and soft deletion support

ALTER TABLE candidates 
    ADD COLUMN IF NOT EXISTS full_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS location VARCHAR(255),
    ADD COLUMN IF NOT EXISTS current_job_title VARCHAR(255),
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Backfill full_name from existing first_name and last_name if any
UPDATE candidates 
SET full_name = TRIM(first_name || ' ' || last_name) 
WHERE full_name IS NULL;

-- Set first_name and last_name as nullable to allow full_name based insertion
ALTER TABLE candidates ALTER COLUMN first_name DROP NOT NULL;
ALTER TABLE candidates ALTER COLUMN last_name DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_candidates_full_name ON candidates(full_name);
CREATE INDEX IF NOT EXISTS idx_candidates_deleted_at ON candidates(deleted_at);
