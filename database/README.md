# Database Migrations & Schema

This directory contains versioned SQL migrations for the PostgreSQL database (`candidate_verification`).

## Migration Inventory

| Version | Up Migration | Down Migration | Description & Tables Created |
| :--- | :--- | :--- | :--- |
| **001** | `001_create_users.sql` | `001_create_users.down.sql` | `users` table with Google subject ID and email uniqueness |
| **002** | `002_create_roles.sql` | `002_create_roles.down.sql` | `roles` and `user_roles` with seed data (`recruiter`, `reviewer`, `admin`) |
| **003** | `003_create_candidates.sql` | `003_create_candidates.down.sql` | `candidates` and `candidate_claims` |
| **004** | `004_create_documents.sql` | `004_create_documents.down.sql` | `documents` metadata table (no binaries stored in DB) |
| **005** | `005_create_verifications.sql` | `005_create_verifications.down.sql` | `verifications` and `validation_issues` |
| **006** | `006_create_sessions.sql` | `006_create_sessions.down.sql` | `sessions` table (storing SHA-256 hashed session tokens) |
| **007** | `007_create_import_batches.sql` | `007_create_import_batches.down.sql` | `import_batches` for bulk candidate CSV ingestion |
| **008** | `008_create_audit_logs.sql` | `008_create_audit_logs.down.sql` | `audit_logs` for immutable event and compliance history |

## Applying Migrations

### Using `psql`:
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
