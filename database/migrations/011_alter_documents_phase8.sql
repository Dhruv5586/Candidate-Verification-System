-- Migration: 011_alter_documents_phase8
-- Description: Adds document_type, upload_status, and updated_at to documents table

ALTER TABLE documents 
    ADD COLUMN IF NOT EXISTS document_type VARCHAR(50) NOT NULL DEFAULT 'resume',
    ADD COLUMN IF NOT EXISTS upload_status VARCHAR(50) NOT NULL DEFAULT 'completed',
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_documents_document_type ON documents(document_type);
CREATE INDEX IF NOT EXISTS idx_documents_checksum ON documents(checksum_sha256);
