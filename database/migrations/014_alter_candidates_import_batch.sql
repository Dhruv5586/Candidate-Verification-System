-- Migration: 014_alter_candidates_import_batch
-- Description: Adds import_batch_id reference to candidates table for tracking bulk CSV ingestion origin

ALTER TABLE candidates
    ADD COLUMN IF NOT EXISTS import_batch_id UUID REFERENCES import_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_candidates_import_batch ON candidates(import_batch_id);
