-- Migration: 003_create_candidates
-- Description: Creates candidates and candidate_claims tables

CREATE TABLE IF NOT EXISTS candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'verified', 'flagged', 'rejected')),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_candidates_email ON candidates(email);
CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(status);
CREATE INDEX IF NOT EXISTS idx_candidates_created_by ON candidates(created_by);

CREATE TABLE IF NOT EXISTS candidate_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    claim_type VARCHAR(50) NOT NULL CHECK (claim_type IN ('education', 'employment', 'identity', 'criminal_check', 'certification', 'reference')),
    organization_name VARCHAR(255) NOT NULL,
    title_or_degree VARCHAR(255),
    start_date DATE,
    end_date DATE,
    status VARCHAR(50) NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified', 'verified', 'discrepant', 'inconclusive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claims_candidate_id ON candidate_claims(candidate_id);
CREATE INDEX IF NOT EXISTS idx_claims_type ON candidate_claims(claim_type);
CREATE INDEX IF NOT EXISTS idx_claims_status ON candidate_claims(status);
