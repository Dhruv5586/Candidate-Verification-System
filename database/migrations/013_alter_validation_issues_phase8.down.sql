-- Migration Rollback: 013_alter_validation_issues_phase8
DROP INDEX IF EXISTS idx_issues_status;
DROP INDEX IF EXISTS idx_issues_document;
DROP INDEX IF EXISTS idx_issues_candidate;
ALTER TABLE validation_issues 
    DROP COLUMN IF EXISTS status,
    DROP COLUMN IF EXISTS document_id,
    DROP COLUMN IF EXISTS candidate_id,
    ALTER COLUMN verification_id SET NOT NULL;
