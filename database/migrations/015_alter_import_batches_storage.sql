-- Migration: 015_alter_import_batches_storage
-- Description: Adds storage and integrity checksum metadata to import_batches table

ALTER TABLE import_batches
    ADD COLUMN IF NOT EXISTS storage_key VARCHAR(255),
    ADD COLUMN IF NOT EXISTS checksum_sha256 VARCHAR(64),
    ADD COLUMN IF NOT EXISTS file_size_bytes INT DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_import_batches_checksum ON import_batches(checksum_sha256);
