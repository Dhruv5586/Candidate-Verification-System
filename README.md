# Candidate Verification System

An enterprise-ready, production-oriented background verification platform engineered with clean architecture.

---

## Tech Stack
- **Authentication:** Go 1.22+ (OpenID Connect, Google OAuth 2.0 with PKCE S256)
- **Database:** PostgreSQL 18.7
- **Database Driver:** `pgx/v5` (`github.com/jackc/pgx/v5/pgxpool`)
- **Backend API (Future):** Node.js + TypeScript + Express
- **Session Management:** Secure server-side sessions with hashed tokens

---

## Phase Status

- [x] **Phase 1: Project Foundation & Security Configuration**
- [x] **Phase 2: Google OAuth 2.0 + OpenID Connect in Go**
- [x] **Phase 3: PostgreSQL Database Integration & Schema**
- [x] **Phase 4: Server-Side Persistent Session Management (Go)**
- [x] **Phase 5: Node.js + TypeScript + Express Backend Foundation**
- [x] **Phase 6: Go Auth + Node.js API Integration**
- [x] **Phase 7: Role-Based Access Control (RBAC)**
- [x] **Phase 8: Candidate Management & Resume Upload (Local Storage)**
- [x] **Phase 9: Bulk CSV Ingestion & Verification Workflow Engine**
- [ ] **Phase 10: Infrastructure, Docker & AWS Deployment**

---

## Database Setup & Migrations

PostgreSQL 18 is required. Database name: `candidate_verification`.

1. Ensure PostgreSQL is running on `localhost:5432`.
2. Apply migrations in order:
   ```bash
   psql -U postgres -d candidate_verification -f database/migrations/001_create_users.sql
   psql -U postgres -d candidate_verification -f database/migrations/002_create_roles.sql
   psql -U postgres -d candidate_verification -f database/migrations/003_create_candidates.sql
   psql -U postgres -d candidate_verification -f database/migrations/004_create_documents.sql
   psql -U postgres -d candidate_verification -f database/migrations/005_create_verifications.sql
   psql -U postgres -d candidate_verification -f database/migrations/006_create_sessions.sql
   psql -U postgres -d candidate_verification -f database/migrations/007_create_import_batches.sql
   psql -U postgres -d candidate_verification -f database/migrations/008_create_audit_logs.sql
   ```

Documentation:
- [API Documentation](docs/API.md)
- [Phase 9 Specification & Architecture](docs/PHASE_9.md)
- [Database Schema Specification](docs/database-design.md)
- [Entity-Relationship Diagram](docs/database-relationships.md)
- [Google OAuth Setup Guide](docs/google-oauth-setup.md)
- [System Architecture](docs/architecture.md)
