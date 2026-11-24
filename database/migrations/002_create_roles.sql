-- Migration: 002_create_roles
-- Description: Creates roles and user_roles tables with core RBAC seed data

CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_roles (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_id);

-- Seed predefined roles safely
INSERT INTO roles (name, description) VALUES
    ('recruiter', 'Can import candidate records, manage candidate claims, and initiate verifications'),
    ('reviewer', 'Can inspect candidate evidence, perform background checks, and submit verification outcomes'),
    ('admin', 'Full system administration, user management, role assignments, and audit log inspection')
ON CONFLICT (name) DO NOTHING;
