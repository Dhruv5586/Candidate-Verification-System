-- Migration: 014_alter_candidates_import_batch (Down)
DROP INDEX IF EXISTS idx_candidates_import_batch;
ALTER TABLE candidates DROP COLUMN IF EXISTS import_batch_id;
