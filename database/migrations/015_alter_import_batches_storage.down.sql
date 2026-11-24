-- Migration: 015_alter_import_batches_storage (Down)
DROP INDEX IF EXISTS idx_import_batches_checksum;
ALTER TABLE import_batches 
    DROP COLUMN IF EXISTS storage_key,
    DROP COLUMN IF EXISTS checksum_sha256,
    DROP COLUMN IF EXISTS file_size_bytes;
