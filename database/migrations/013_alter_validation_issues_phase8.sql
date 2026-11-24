-- Migration: 013_alter_validation_issues_phase8
-- Description: Decouples validation_issues from verifications to allow automated resume checks on upload

ALTER TABLE validation_issues 
    ALTER COLUMN verification_id DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS candidate_id UUID REFERENCES candidates(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'open' 
        CHECK (status IN ('open', 'resolved', 'dismissed'));

CREATE INDEX IF NOT EXISTS idx_issues_candidate ON validation_issues(candidate_id);
CREATE INDEX IF NOT EXISTS idx_issues_document ON validation_issues(document_id);
CREATE INDEX IF NOT EXISTS idx_issues_status ON validation_issues(status);
