-- Migration: 012_create_resume_extractions
-- Description: Creates resume_extractions table for parsed text and structured document metadata

CREATE TABLE IF NOT EXISTS resume_extractions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
    extracted_text TEXT NOT NULL,
    extracted_data JSONB,
    extraction_status VARCHAR(50) NOT NULL DEFAULT 'completed' 
        CHECK (extraction_status IN ('pending', 'processing', 'completed', 'failed', 'unreadable')),
    parser_name VARCHAR(100) NOT NULL,
    parser_version VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resume_extractions_document ON resume_extractions(document_id);
CREATE INDEX IF NOT EXISTS idx_resume_extractions_status ON resume_extractions(extraction_status);
