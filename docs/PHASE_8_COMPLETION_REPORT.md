# Candidate Verification System — Comprehensive Progress & Phase 8 Completion Report

**Date:** November 23, 2026  
**Project:** Candidate Verification System  
**Current Milestone Completed:** **Phase 8: Candidate Management & Resume Upload (Local Storage)**  
**Overall Status:** **Phases 1 through 8 Completed & Verified**  

---

## 1. Executive Summary

The **Candidate Verification System** is an enterprise-grade, background verification and compliance platform built using a clean, decoupled two-tier architecture:
- **Go 1.22+ Auth Service (Port 8080):** High-throughput authentication microservice providing Google OAuth 2.0 with PKCE (RFC 7636), OpenID Connect token verification, persistent database-backed session management, token rotation, and internal service-to-service validation (`X-Internal-Secret`).
- **Node.js + TypeScript + Express Backend (Port 3000):** Business logic engine, Role-Based Access Control (RBAC), resource-level authorization boundaries, candidate lifecycle management, resume upload with private local storage, text extraction, automated validation heuristics, and immutable audit logging.
- **PostgreSQL 18.7:** Centralized relational database (`candidate_verification`) shared safely between both services with versioned, reversible migrations.
- **Local Private File Storage:** Resumes are isolated under `private-storage/resumes/` outside the web root, guarded against directory traversal, named using randomized UUIDs, and hashed via SHA-256.

```mermaid
graph TB
    Client["Client / Web UI"]
    GoAuth["Go Auth Service (:8080)<br/>OAuth 2.0 + Sessions"]
    NodeAPI["Node.js Express API (:3000)<br/>RBAC + Candidates + Storage + Validation"]
    Postgres[("PostgreSQL 18.7<br/>(candidate_verification)")]
    Disk[("Private Storage<br/>(private-storage/resumes)")]

    Client -->|1. Google OAuth / Login| GoAuth
    GoAuth -->|2. Store Hashed Sessions| Postgres
    Client -->|3. API Request + Session Cookie/Token| NodeAPI
    NodeAPI -->|4. Validate Session (Internal RPC)| GoAuth
    NodeAPI -->|5. Verify User Roles & Permissions| Postgres
    NodeAPI -->|6. Candidate Metadata & Audit Logs| Postgres
    NodeAPI -->|7. Encrypted / UUID File Stream| Disk
```

---

## 2. Project Milestone Roadmap

| Milestone | Scope | Tech Stack | Status |
| :--- | :--- | :--- | :--- |
| **Phase 1** | Project Foundation, Environment Configuration & Security Headers | Go & Node.js | Completed |
| **Phase 2** | Google OAuth 2.0 + OpenID Connect with PKCE S256 | Go 1.22+ | Completed |
| **Phase 3** | PostgreSQL Database Integration & Schema Migrations (001–008) | PostgreSQL 18.7 | Completed |
| **Phase 4** | Server-Side Persistent Session Management & Token Rotation | Go & PostgreSQL | Completed |
| **Phase 5** | Node.js + TypeScript Express Backend Setup & Database Pooling | Node.js, TS, Express | Completed |
| **Phase 6** | Go Auth + Node.js API Integration Middleware (`/auth/me`) | Node.js, Go HTTP | Completed |
| **Phase 7** | Role-Based Access Control (RBAC) & Resource Authorization | Node.js & PostgreSQL | Completed |
| **Phase 8** | Candidate Management, Resume Upload & Validation Rules (Local Storage) | Node.js, Multer, PDF/DOCX | Completed |
| **Phase 9** | Bulk CSV Ingestion & Verification Workflow Engine | Node.js & PostgreSQL | *Next Phase* |
| **Phase 10** | Infrastructure, Docker Orchestration & Cloud Deployment | Docker, AWS | *Pending* |

---

## 3. Phase 8 Implementation Deep Dive

### 3.1 Local Private Storage Security Architecture
- **Directory Isolation:** Files are written to `D:\CandidateVerificationSystem\private-storage\resumes`, located completely outside the web application directory and never served via `express.static()`.
- **Randomized UUID Filenames:** Files are saved on disk as `<uuid>.pdf` or `<uuid>.docx` using `crypto.randomUUID()`. Original filenames are stored only in the PostgreSQL database.
- **SHA-256 Cryptographic Integrity:** All file uploads are hashed via SHA-256 upon ingest. Duplicate uploads for the same candidate are rejected with HTTP 409 Conflict.
- **Directory Traversal Protection:** All storage keys are resolved using `path.basename()` and strictly verified to reside within `RESUME_STORAGE_PATH`.
- **Stream Downloads:** Resumes are downloaded exclusively through authenticated streaming endpoints with sanitized `Content-Disposition` attachment headers and logged in `audit_logs`.
- **Git Protection:** `private-storage/` is excluded via `.gitignore`.

### 3.2 Magic Byte & Payload Validation
1. **File Size Bound:** Capped at 5 MB maximum (`MAX_RESUME_SIZE_MB=5`).
2. **MIME Enforcement:** Accepts only `application/pdf` and `application/vnd.openxmlformats-officedocument.wordprocessingml.document`.
3. **Magic-Byte Signature Verification:**
   - **PDF:** Checked for `%PDF-` signature (`0x25, 0x50, 0x44, 0x46`).
   - **DOCX:** Checked for ZIP archive signature `PK\x03\x04` (`0x50, 0x4B, 0x03, 0x04`).
   - Spoofed files (e.g., text files renamed to `.pdf`) are immediately rejected with HTTP 400 Bad Request.

### 3.3 Safe In-Memory Text Extraction
- Extraction runs purely in memory without invoking external viewers, macros, or shell interpreters.
- **PDF Extraction:** Handled via `pdf-parse`, bounded to 50 pages maximum and 250,000 characters to prevent memory exhaustion attacks.
- **DOCX Extraction:** Handled via `mammoth` for raw text extraction.

### 3.4 Automated Rule-Based Validation Checks
Extracted resumes are automatically evaluated against 10 verification heuristics, and any anomalies are recorded in `validation_issues` as flags for human reviewers:

| # | Check Name | Severity | Description |
| :--- | :--- | :--- | :--- |
| 1 | `EMPTY_OR_UNREADABLE_DOCUMENT` | `critical` | Extracted text is empty or under 50 characters (e.g., scanned images without OCR). |
| 2 | `NAME_NOT_FOUND` | `medium` | None of the candidate's name tokens appear in the resume text. |
| 3 | `EMAIL_MISMATCH` | `high` | Candidate's profile email does not appear in the resume. |
| 4 | `PHONE_NOT_DETECTED` | `low` | Registered phone number digits do not match resume text. |
| 5 | `EDUCATION_SECTION_MISSING` | `medium` | No academic or degree keywords (degree, university, bachelor, etc.) found. |
| 6 | `EXPERIENCE_SECTION_MISSING` | `low` | No work experience or career history keywords found. |
| 7 | `INVALID_DATE_RANGE` | `critical` | Inverted chronological date bounds detected (e.g., `2024 - 2020`). |
| 8 | `FUTURE_DATE_ANOMALY` | `medium` | Dates referencing years beyond the realistic horizon (current year + 2). |
| 9 | `UNCONVENTIONAL_DATE_FORMAT` | `low` | No standardized date formats recognized in work history. |
| 10 | `INCOMPLETE_CONTACT_METADATA` | `low` | Candidate profile missing phone or location metadata. |

---

## 4. Database Migrations Status

All 13 migrations are applied and active in PostgreSQL:

| Migration File | Primary Purpose | Status |
| :--- | :--- | :--- |
| `001_create_users.sql` | Users table and indexes | Applied |
| `002_create_roles.sql` | Roles and user_roles tables (`admin`, `recruiter`, `reviewer`) | Applied |
| `003_create_candidates.sql` | Candidates and candidate_claims tables | Applied |
| `004_create_documents.sql` | Documents table for metadata and checksums | Applied |
| `005_create_verifications.sql` | Verifications and validation_issues tables | Applied |
| `006_create_sessions.sql` | Persistent server-side sessions with SHA-256 tokens | Applied |
| `007_create_import_batches.sql` | CSV ingestion tracking | Applied |
| `008_create_audit_logs.sql` | Immutable audit trail with actor, action, old/new state | Applied |
| `009_seed_rbac_roles.sql` | Idempotent role seeds (`admin`, `recruiter`, `reviewer`) | Applied |
| `010_alter_candidates_phase8.sql` | Added `full_name`, `location`, `current_job_title`, `deleted_at` | Applied |
| `011_alter_documents_phase8.sql` | Added `document_type`, `upload_status`, `updated_at` | Applied |
| `012_create_resume_extractions.sql` | Created `resume_extractions` table | Applied |
| `013_alter_validation_issues_phase8.sql` | Made `verification_id` nullable, added `candidate_id`, `document_id` | Applied |

---

## 5. API Reference Summary

| Method | Endpoint | Authorization | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/health` | Public | System status, uptime, environment |
| `GET` | `/api/v1/health/database` | Public | PostgreSQL connection pool status |
| `GET` | `/api/v1/docs` | Public | Interactive Swagger UI documentation |
| `GET` | `/api/v1/auth/me` | Authenticated | Verified profile & roles via Go Auth session validation |
| `GET` | `/api/v1/rbac/admin` | Admin | Admin access check |
| `GET` | `/api/v1/rbac/recruiter` | Recruiter, Admin | Recruiter access check |
| `GET` | `/api/v1/rbac/reviewer` | Reviewer, Admin | Reviewer access check |
| `POST` | `/api/v1/rbac/roles/assign` | Admin | Assigns role to user with audit logging |
| `POST` | `/api/v1/candidates` | Admin, Recruiter | Create candidate profile |
| `GET` | `/api/v1/candidates` | Admin, Recruiter, Reviewer | List candidates with pagination and search |
| `GET` | `/api/v1/candidates/:id` | Admin, Recruiter, Reviewer | Get candidate profile and document counts |
| `PATCH` | `/api/v1/candidates/:id` | Admin, Recruiter | Update candidate profile |
| `DELETE` | `/api/v1/candidates/:id` | Admin, Recruiter | Soft-delete candidate |
| `POST` | `/api/v1/candidates/:id/resumes` | Admin, Recruiter | Upload resume, validate magic bytes, extract text, run validation rules |
| `GET` | `/api/v1/candidates/:id/resumes` | Admin, Recruiter, Reviewer | List uploaded candidate resumes |
| `GET` | `/api/v1/resumes/:documentId` | Admin, Recruiter, Reviewer | Retrieve resume metadata, extraction, and validation issues |
| `GET` | `/api/v1/resumes/:documentId/download` | Admin, Recruiter, Reviewer | Stream resume download with audit logging |

---

## 6. Test Suite & Verification Results

### 6.1 Node.js API Verification
```bash
> tsx --test src/tests/**/*.test.ts

✔ Node.js Express App & Health Endpoints (4 tests passed)
✔ Go Auth + Node.js Integration (Auth Middleware & /api/v1/auth/me) (7 tests passed)
✔ Environment & Configuration Test Suite (5 tests passed)
✔ Phase 7: Role-Based Access Control (RBAC) Test Suite (12 tests passed)
✔ Phase 8: Candidate Management & Resume Upload Test Suite (21 tests passed)

Total: 49 tests, 5 test suites — 100% PASS (0 failures, 0 skipped)
Duration: ~32.6s
```
- **Typecheck:** `tsc --noEmit` exited with code 0 (0 errors).
- **Build:** `tsc` exited with code 0.

### 6.2 Go Auth Verification
```bash
> go test -count=1 ./tests/...
ok candidate-verification/go-auth/tests 0.538s (27 tests passed)

> go vet ./...
[Exit Code 0]

> go build ./...
[Exit Code 0]
```

---

## 7. Next Steps (Phase 9)

With Phase 8 fully tested and operational, the system is primed for **Phase 9: Bulk Ingestion Engine & Verification Workflow**:
- Automated CSV ingestion engine parsing and validating bulk candidate records.
- Staging and validation queues using `import_batches`.
- End-to-end verification workflows assigning reviewer tasks and tracking credential verification progress.
