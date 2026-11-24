-- Migration Rollback: 011_alter_documents_phase8
DROP INDEX IF EXISTS idx_documents_checksum;
DROP INDEX IF EXISTS idx_documents_document_type;
ALTER TABLE documents 
    DROP COLUMN IF EXISTS updated_at,
    DROP COLUMN IF EXISTS upload_status,
    DROP COLUMN IF EXISTS document_type;
