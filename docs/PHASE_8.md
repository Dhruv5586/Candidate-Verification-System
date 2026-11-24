# Phase 8: Candidate Management & Resume Upload (Local Storage)

## 1. Overview & Architecture

Phase 8 implements comprehensive candidate profile lifecycle management, secure resume upload with local private filesystem storage, automated safe text extraction, and rule-based verification anomaly detection.

```
+-----------------------------------------------------------------------------------+
|                                 Client (Web / API)                                |
+-----------------------------------------+-----------------------------------------+
                                          |
                        Bearer Token / cvs_session Cookie
                                          v
+-----------------------------------------------------------------------------------+
|                            Node.js Express API (Port 3000)                        |
|                                                                                   |
|  [requireAuth] ---> Session Validation RPC ---> Go Auth (Port 8080)               |
|  [requireRole] ---> Roles Lookup / Verification ---> PostgreSQL 18.7              |
|                                                                                   |
|  Controllers & Services:                                                          |
|  - CandidateService: CRUD, Zod validation, search, pagination, soft delete        |
|  - StorageService: Private local filesystem (UUID filenames, SHA-256)             |
|  - UploadMiddleware: 5MB limit, MIME check & Magic Byte verification              |
|  - ExtractionService: pdf-parse (PDF) & mammoth (DOCX) text extraction            |
|  - ResumeValidationService: 10 automated verification rule checks                 |
|  - AuditLogRepository: Comprehensive compliance audit trail                       |
+-----------------------------------------+-----------------------------------------+
                                          |
                   +----------------------+----------------------+
                   |                                             |
                   v                                             v
+------------------------------------+        +-------------------------------------+
|        PostgreSQL Database         |        |       Private Storage Path          |
|      (candidate_verification)      |        |   (D:\...\private-storage\resumes)  |
|                                    |        |                                     |
| - candidates (profiles & status)   |        | - Stored outside web server root    |
| - documents (metadata & hashes)    |        | - Restricted permissions (0700/0600)|
| - resume_extractions (text & meta) |        | - Random UUID filenames             |
| - validation_issues (rule checks)  |        | - Never served via static route     |
| - audit_logs (immutable trail)     |        | - Streamed only via auth controller |
+------------------------------------+        +-------------------------------------+
```

---

## 2. Security Architecture

### 2.1 Private Local Storage Boundaries
- **Storage Location:** `private-storage/resumes` (configurable via `RESUME_STORAGE_PATH` in `.env`).
- **Outside Web Root:** Resumes are never placed in public directories or served via `express.static()`.
- **Randomized UUID Filenames:** Files are saved on disk as `<uuid>.pdf` or `<uuid>.docx` to prevent file collision, overwriting, and enumeration attacks. Original file names are recorded only as database metadata.
- **SHA-256 Integrity Hashes:** Every uploaded file buffer is hashed with SHA-256 before storage. Duplicate uploads for the same candidate are rejected with HTTP 409 Conflict.
- **Path Traversal Protection:** All storage keys are sanitized using `path.basename()` and verified against directory boundaries before file operations.
- **Git Exclusion:** `private-storage/` is explicitly ignored in `.gitignore`.

### 2.2 Magic Byte & Payload Validation
- **Size Limitation:** Capped at 5MB maximum (`MAX_RESUME_SIZE_MB=5`).
- **MIME & Extension Enforcement:** Accepts only `.pdf` and `.docx`.
- **Magic-Byte Signature Verification:**
  - PDF: Verified for `%PDF-` header (`0x25, 0x50, 0x44, 0x46`).
  - DOCX: Verified for PK Zip header (`0x50, 0x4B, 0x03, 0x04`).
  - Corrupt or spoofed files (e.g., text or script files renamed to `.pdf`) are rejected with HTTP 400 Bad Request.

### 2.3 Safe Text Extraction
- Extraction runs purely in memory without executing embedded macros, OLE objects, or external viewers.
- PDF: Extracted using `pdf-parse` (capped at 50 pages and 250,000 characters).
- DOCX: Extracted using `mammoth` for raw text generation.

---

## 3. Database Schema & Migrations

Four versioned and reversible migrations were executed:

1. **`010_alter_candidates_phase8.sql`:**
   - Added `full_name VARCHAR(255) NOT NULL`, `location VARCHAR(255)`, `current_job_title VARCHAR(255)`, `deleted_at TIMESTAMPTZ`.
   - Added indexes on `candidates(email)`, `candidates(created_by)`, and `candidates(deleted_at)`.
2. **`011_alter_documents_phase8.sql`:**
   - Added `document_type VARCHAR(50) DEFAULT 'resume'`, `upload_status VARCHAR(50) DEFAULT 'completed'`, `updated_at TIMESTAMPTZ`.
   - Added indexes on `documents(candidate_id, checksum_sha256)`.
3. **`012_create_resume_extractions.sql`:**
   - Created `resume_extractions` table tracking `document_id`, `extracted_text`, `extracted_data (JSONB)`, `extraction_status`, `parser_name`, `parser_version`.
4. **`013_alter_validation_issues_phase8.sql`:**
   - Made `verification_id` nullable (permitting pre-verification resume analysis).
   - Added `candidate_id UUID REFERENCES candidates(id)`, `document_id UUID REFERENCES documents(id)`, and `status VARCHAR(50) DEFAULT 'open'`.

---

## 4. API Specification

| Method | Endpoint | Allowed Roles | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/candidates` | Admin, Recruiter | Create candidate profile (Zod validation, duplicate email check) |
| `GET` | `/api/v1/candidates` | Admin, Recruiter, Reviewer | List candidates with pagination (`page`, `limit`) & `search` |
| `GET` | `/api/v1/candidates/:id` | Admin, Recruiter, Reviewer | Get candidate details by UUID |
| `PATCH` | `/api/v1/candidates/:id` | Admin, Recruiter | Update candidate profile |
| `DELETE` | `/api/v1/candidates/:id` | Admin, Recruiter | Soft-delete candidate record (sets `deleted_at`) |
| `POST` | `/api/v1/candidates/:id/resumes` | Admin, Recruiter | Upload PDF/DOCX resume, extract text, evaluate validation checks |
| `GET` | `/api/v1/candidates/:id/resumes` | Admin, Recruiter, Reviewer | List uploaded resumes for candidate |
| `GET` | `/api/v1/resumes/:documentId` | Admin, Recruiter, Reviewer | View document metadata, extraction info, and validation issues |
| `GET` | `/api/v1/resumes/:documentId/download` | Admin, Recruiter, Reviewer | Stream resume file securely with `Content-Disposition: attachment` |

---

## 5. Automated Rule-Based Validation Checks

All extracted resumes are automatically analyzed across 10 verification heuristics. Issues are logged in `validation_issues` as flags for human reviewers to inspect, never as automatic fraud determinations:

1. **`EMPTY_OR_UNREADABLE_DOCUMENT`:** Flagged if parsed text is empty or under 50 characters (e.g., scanned images without OCR).
2. **`NAME_NOT_FOUND`:** Flagged if none of the candidate's name tokens appear in the resume text.
3. **`EMAIL_MISMATCH`:** Flagged if the candidate's profile email is missing from the resume.
4. **`PHONE_NOT_DETECTED`:** Informational note if registered phone number digits do not appear in the resume.
5. **`EDUCATION_SECTION_MISSING`:** Flagged if standard academic keywords (degree, university, bachelor, etc.) are absent.
6. **`EXPERIENCE_SECTION_MISSING`:** Flagged if employment/experience keywords (work history, career, etc.) are absent.
7. **`INVALID_DATE_RANGE`:** Flagged if chronological date bounds are inverted (e.g., `2024 - 2020`).
8. **`UNREALISTIC_EXPERIENCE_DURATION`:** Flagged if continuous employment stints exceed 45 years.
9. **`FREQUENT_SHORT_STINTS`:** Informational alert if more than 4 brief roles (< 6 months) appear in close proximity.
10. **`KEYWORD_STUFFING`:** Flagged if specific technical keywords appear with suspicious repetitive frequency (> 25 occurrences).

---

## 6. Audit Logging

Every candidate mutation and document action generates an immutable audit record in `audit_logs`:
- `CANDIDATE_CREATED`: Logged when a recruiter creates a candidate.
- `CANDIDATE_UPDATED`: Logged with before and after field deltas.
- `CANDIDATE_DELETED`: Logged with soft deletion timestamp.
- `RESUME_UPLOADED`: Logged with file name, storage key, file size, and checksum.
- `RESUME_DOWNLOADED`: Logged when any user streams/downloads a resume document.
