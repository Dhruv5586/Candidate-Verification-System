# Database Design & Schema Specification

This document provides the complete specification of the relational schema for the **Candidate Verification System** hosted in PostgreSQL 18.

---

## 1. Architectural Design Principles

1. **UUID Primary Keys:** All tables use globally unique identifiers (`gen_random_uuid()`) to prevent enumeration attacks and simplify distributed data sharding.
2. **Deterministic Foreign Keys & Cascades:**
   - Dependent transactional records (`candidate_claims`, `documents`, `sessions`, `verifications`, `validation_issues`) cascade on parent deletion.
   - Auditable ownership relations (`created_by`, `uploaded_by`, `reviewer_id`) use `ON DELETE SET NULL` to preserve historical integrity.
3. **External Identity Anchoring:** `users.google_subject_id` serves as the immutable, verified external identity anchor from Google OIDC.
4. **Metadata-Only Document Storage:** The `documents` table stores file metadata, S3 storage keys, and cryptographic SHA-256 checksums; raw file binaries are never stored in the relational database.
5. **Secure Session Design:** The `sessions` table exclusively stores **SHA-256 hashes** (`token_hash`) of server-side session tokens. Raw tokens exist only in client HTTP-only cookies and are never saved in plaintext.
6. **Immutable Audit Trail:** `audit_logs` maintains a permanent log of all critical system events with JSONB snapshots of previous and updated states.

---

## 2. Table Specifications (All 11 Tables)

### Table 1: `users`
Identity records for recruiters, reviewers, and administrators authenticated via Google OAuth/OIDC.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Unique user identifier |
| `google_subject_id` | `VARCHAR(255)` | `NOT NULL UNIQUE` | Google OIDC unique immutable `sub` claim |
| `email` | `VARCHAR(255)` | `NOT NULL UNIQUE` | User primary email address |
| `email_verified` | `BOOLEAN` | `NOT NULL DEFAULT false` | Google verified email flag |
| `name` | `VARCHAR(255)` | `NOT NULL` | Full display name |
| `given_name` | `VARCHAR(255)` | `NULL` | First name |
| `family_name` | `VARCHAR(255)` | `NULL` | Last name |
| `picture` | `VARCHAR(1024)` | `NULL` | URL to Google avatar image |
| `is_active` | `BOOLEAN` | `NOT NULL DEFAULT true` | Account activation switch |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Record creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Record last update timestamp |

**Indexes:**
- `idx_users_google_sub` ON `(google_subject_id)`
- `idx_users_email` ON `(email)`
- `idx_users_is_active` ON `(is_active)`

---

### Table 2: `roles`
Role-based authorization tiers.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Role unique identifier |
| `name` | `VARCHAR(50)` | `NOT NULL UNIQUE` | Role name (`recruiter`, `reviewer`, `admin`) |
| `description` | `TEXT` | `NULL` | Role permissions and scope description |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Record creation timestamp |

**Seed Data:**
- `recruiter`: Can create candidate records, upload batch CSVs, and initiate verification workflows.
- `reviewer`: Can inspect claims, examine uploaded evidence, and record verification verdicts.
- `admin`: Superuser managing user activation, role bindings, system audit logs, and configuration.

---

### Table 3: `user_roles`
Many-to-many junction linking users to roles.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `user_id` | `UUID` | `REFERENCES users(id) ON DELETE CASCADE` | Assigned user |
| `role_id` | `UUID` | `REFERENCES roles(id) ON DELETE CASCADE` | Assigned role |
| `assigned_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Assignment timestamp |

**Primary Key:** `(user_id, role_id)`  
**Indexes:** `idx_user_roles_user`, `idx_user_roles_role`

---

### Table 4: `candidates`
Candidates submitted for background verification.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Candidate identifier |
| `first_name` | `VARCHAR(100)` | `NOT NULL` | Candidate given name |
| `last_name` | `VARCHAR(100)` | `NOT NULL` | Candidate surname |
| `email` | `VARCHAR(255)` | `NOT NULL` | Candidate contact email |
| `phone` | `VARCHAR(50)` | `NULL` | Candidate telephone |
| `status` | `VARCHAR(50)` | `NOT NULL DEFAULT 'pending' CHECK (...)` | Verification status: `pending`, `in_progress`, `verified`, `flagged`, `rejected` |
| `created_by` | `UUID` | `REFERENCES users(id) ON DELETE SET NULL` | Recruiter who created the candidate |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Ingestion timestamp |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Last update timestamp |

**Indexes:** `idx_candidates_email`, `idx_candidates_status`, `idx_candidates_created_by`

---

### Table 5: `candidate_claims`
Specific background claims asserted for a candidate.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Claim identifier |
| `candidate_id` | `UUID` | `REFERENCES candidates(id) ON DELETE CASCADE` | Associated candidate |
| `claim_type` | `VARCHAR(50)` | `NOT NULL CHECK (...)` | `education`, `employment`, `identity`, `criminal_check`, `certification`, `reference` |
| `organization_name` | `VARCHAR(255)` | `NOT NULL` | Company or university name |
| `title_or_degree` | `VARCHAR(255)` | `NULL` | Degree attained or job position |
| `start_date` | `DATE` | `NULL` | Claim start date |
| `end_date` | `DATE` | `NULL` | Claim end date |
| `status` | `VARCHAR(50)` | `NOT NULL DEFAULT 'unverified' CHECK (...)` | `unverified`, `verified`, `discrepant`, `inconclusive` |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Claim creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Claim last updated |

**Indexes:** `idx_claims_candidate_id`, `idx_claims_type`, `idx_claims_status`

---

### Table 6: `documents`
Uploaded supporting documentation and proof files (metadata only).

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Document identifier |
| `candidate_id` | `UUID` | `REFERENCES candidates(id) ON DELETE CASCADE` | Associated candidate |
| `claim_id` | `UUID` | `REFERENCES candidate_claims(id) ON DELETE SET NULL` | Specific claim linked to document |
| `file_name` | `VARCHAR(255)` | `NOT NULL` | Original client file name |
| `file_type` | `VARCHAR(100)` | `NOT NULL` | MIME type (e.g. `application/pdf`) |
| `file_size_bytes` | `BIGINT` | `NOT NULL` | Size in bytes |
| `storage_key` | `VARCHAR(512)` | `NOT NULL` | S3 / Object store object key |
| `checksum_sha256` | `VARCHAR(64)` | `NOT NULL` | Cryptographic SHA-256 content checksum |
| `uploaded_by` | `UUID` | `REFERENCES users(id) ON DELETE SET NULL` | User who uploaded the document |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Upload timestamp |

**Indexes:** `idx_documents_candidate`, `idx_documents_claim`, `idx_documents_uploaded_by`

---

### Table 7: `verifications`
Reviewer evaluations and outcomes for claims.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Verification record identifier |
| `candidate_id` | `UUID` | `REFERENCES candidates(id) ON DELETE CASCADE` | Associated candidate |
| `claim_id` | `UUID` | `REFERENCES candidate_claims(id) ON DELETE CASCADE` | Verified claim |
| `reviewer_id` | `UUID` | `REFERENCES users(id) ON DELETE SET NULL` | Reviewer performing check |
| `status` | `VARCHAR(50)` | `NOT NULL DEFAULT 'pending' CHECK (...)` | `pending`, `passed`, `failed`, `requires_review` |
| `notes` | `TEXT` | `NULL` | Reviewer findings and justification |
| `verified_at` | `TIMESTAMPTZ` | `NULL` | Completion timestamp |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Record created |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Record updated |

**Indexes:** `idx_verifications_candidate`, `idx_verifications_claim`, `idx_verifications_reviewer`, `idx_verifications_status`

---

### Table 8: `validation_issues`
Discrepancies identified during verification.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Issue identifier |
| `verification_id` | `UUID` | `REFERENCES verifications(id) ON DELETE CASCADE` | Associated verification |
| `severity` | `VARCHAR(50)` | `NOT NULL CHECK (...)` | `low`, `medium`, `high`, `critical` |
| `issue_type` | `VARCHAR(100)` | `NOT NULL` | Type (e.g. `date_mismatch`, `fraudulent_credential`) |
| `description` | `TEXT` | `NOT NULL` | Issue explanation |
| `resolved` | `BOOLEAN` | `NOT NULL DEFAULT false` | Resolution flag |
| `resolved_by` | `UUID` | `REFERENCES users(id) ON DELETE SET NULL` | User who resolved issue |
| `resolved_at` | `TIMESTAMPTZ` | `NULL` | Resolution timestamp |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Issue reported timestamp |

**Indexes:** `idx_issues_verification`, `idx_issues_severity`, `idx_issues_resolved`

---

### Table 9: `sessions`
Secure server-side sessions with hashed tokens.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Session identifier |
| `user_id` | `UUID` | `REFERENCES users(id) ON DELETE CASCADE` | Session owner |
| `token_hash` | `VARCHAR(64)` | `NOT NULL UNIQUE` | SHA-256 hash of session bearer token |
| `ip_address` | `VARCHAR(45)` | `NULL` | Client IPv4 / IPv6 address |
| `user_agent` | `TEXT` | `NULL` | Client browser user agent |
| `expires_at` | `TIMESTAMPTZ` | `NOT NULL` | Expiration deadline |
| `is_revoked` | `BOOLEAN` | `NOT NULL DEFAULT false` | Immediate revocation flag |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Session issuance timestamp |
| `last_accessed_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Last activity timestamp |

**Indexes:** `idx_sessions_user_id`, `idx_sessions_token_hash`, `idx_sessions_expires_at`, `idx_sessions_revoked`

---

### Table 10: `import_batches`
Tracks CSV bulk candidate ingestion jobs.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Batch job identifier |
| `uploaded_by` | `UUID` | `REFERENCES users(id) ON DELETE SET NULL` | Recruiter uploading CSV |
| `file_name` | `VARCHAR(255)` | `NOT NULL` | Ingested file name |
| `total_rows` | `INT` | `NOT NULL DEFAULT 0` | Total CSV data rows |
| `processed_rows` | `INT` | `NOT NULL DEFAULT 0` | Rows evaluated |
| `successful_rows` | `INT` | `NOT NULL DEFAULT 0` | Candidates created |
| `failed_rows` | `INT` | `NOT NULL DEFAULT 0` | Rows with validation errors |
| `status` | `VARCHAR(50)` | `NOT NULL DEFAULT 'pending' CHECK (...)` | `pending`, `processing`, `completed`, `failed` |
| `error_summary` | `JSONB` | `DEFAULT '{}'::jsonb` | Structured row error details |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Ingestion start |
| `completed_at` | `TIMESTAMPTZ` | `NULL` | Ingestion end |

**Indexes:** `idx_import_batches_uploaded_by`, `idx_import_batches_status`

---

### Table 11: `audit_logs`
Immutable compliance and security audit trail.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Audit log identifier |
| `user_id` | `UUID` | `REFERENCES users(id) ON DELETE SET NULL` | Performing user |
| `action` | `VARCHAR(100)` | `NOT NULL` | Action code (e.g. `USER_LOGIN`, `VERIFICATION_PASSED`) |
| `entity_type` | `VARCHAR(100)` | `NOT NULL` | Target entity (`candidate`, `claim`, `user`) |
| `entity_id` | `UUID` | `NULL` | Target record UUID |
| `old_values` | `JSONB` | `NULL` | Prior record state |
| `new_values` | `JSONB` | `NULL` | New record state |
| `ip_address` | `VARCHAR(45)` | `NULL` | Originating IP address |
| `user_agent` | `TEXT` | `NULL` | Originating user agent |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Immutable log timestamp |

**Indexes:** `idx_audit_logs_user_id`, `idx_audit_logs_action`, `idx_audit_logs_entity`, `idx_audit_logs_created_at`
