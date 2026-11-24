-- Migration Rollback: 010_alter_candidates_phase8
DROP INDEX IF EXISTS idx_candidates_deleted_at;
DROP INDEX IF EXISTS idx_candidates_full_name;
ALTER TABLE candidates 
    DROP COLUMN IF EXISTS deleted_at,
    DROP COLUMN IF EXISTS current_job_title,
    DROP COLUMN IF EXISTS location,
    DROP COLUMN IF EXISTS full_name;
