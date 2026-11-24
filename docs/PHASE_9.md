# Phase 9: Bulk CSV Ingestion & Verification Workflow Engine

## 1. Overview & Architecture

Phase 9 delivers an enterprise bulk CSV candidate ingestion pipeline with chunked transactional execution and a multi-stage verification workflow engine enforcing strict separation of duties between recruiters and reviewers.

```
+-------------------------------------------------------------------------------------------------+
|                                        Client (Web / API)                                       |
+------------------------------------------------+------------------------------------------------+
                                                 |
                               Session Token / Cookie
                                                 v
+-------------------------------------------------------------------------------------------------+
|                                 Node.js Express API (Port 3000)                                 |
|                                                                                                 |
|   Authentication & RBAC Middleware:                                                             |
|   - requireAuth: Validates session with Go Auth (:8080)                                         |
|   - requireRole / requireAnyRole: Enforces role permissions                                     |
|   - Separation of Duties: Recruiters can ingest & add claims; Reviewers review & verify            |
|                                                                                                 |
|   Ingestion Pipeline (/api/v1/imports):                                                         |
|   - Upload & Preview: Validates CSV format, stores file in private storage, previews rows       |
|   - Execute Batch: Chunked streaming (50 rows/chunk), Zod validation, email duplicate checks     |
|   - Error Summary: Captures row-level errors in error_summary JSONB                             |
|                                                                                                 |
|   Verification Workflow (/api/v1/verifications & /api/v1/candidates/:id/claims):                |
|   - Claims Management: Education, employment, certification, identity, and references           |
|   - Verification Queue: Prioritized queue (urgent, high, normal, low) for human reviewers       |
|   - Review Execution: Reviewers submit decisions (passed, failed, requires_review)              |
|   - Status Synchronization: Automatically updates claim and overall candidate statuses          |
|   - Audit Trail: Immutable event logging for all mutations                                      |
+------------------------------------------------+------------------------------------------------+
                                                 |
                         +-----------------------+-----------------------+
                         |                                               |
                         v                                               v
+------------------------------------------------+       +----------------------------------------+
|              PostgreSQL 18.7                   |       |         Private Local Storage          |
|          (candidate_verification)              |       |   (D:\...\private-storage\...)         |
|                                                |       |                                        |
| - import_batches (files, counts, error_summary)|       | - Stored outside web root              |
| - candidates (linked via import_batch_id)      |       | - Random UUID filenames                |
| - candidate_claims (verifiable credentials)    |       | - SHA-256 integrity hash               |
| - verifications (queue, priorities, reviews)   |       | - Protected from directory traversal   |
| - audit_logs (immutable event history)         |       | - Streamed only via auth endpoints     |
+------------------------------------------------+       +----------------------------------------+
```

---

## 2. Database Migrations

Three versioned migrations were executed:

1. **`014_alter_candidates_import_batch.sql`:**
   - Added `import_batch_id UUID REFERENCES import_batches(id) ON DELETE SET NULL` to `candidates`.
   - Created index `idx_candidates_import_batch ON candidates(import_batch_id)`.
2. **`015_alter_import_batches_storage.sql`:**
   - Added `storage_key VARCHAR(255)`, `checksum_sha256 VARCHAR(64)`, and `file_size_bytes INT` to `import_batches`.
   - Created index `idx_import_batches_checksum ON import_batches(checksum_sha256)`.
3. **`016_alter_verifications_phase9.sql`:**
   - Added `priority VARCHAR(20) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent'))` and `assigned_at TIMESTAMPTZ` to `verifications`.
   - Created indexes on `verifications(priority)` and `verifications(assigned_at)`.

---

## 3. Bulk CSV Ingestion Engine

### 3.1 Upload & Preview Flow (`POST /api/v1/imports/upload`)
- Validates file extension (`.csv`) and MIME type (`text/csv`, `application/vnd.ms-excel`, etc.).
- Saves the CSV file to private local storage with a random UUID filename and computes its SHA-256 integrity checksum.
- Parses headers with normalization (supporting `Full Name`, `full_name`, `name`, `Email`, `Phone`, `Location`, `Current Job Title`).
- Reads the first 5 rows for client preview and counts total rows without inserting into the database.
- Creates an `import_batches` record with status `pending`.

### 3.2 Chunked Ingestion Flow (`POST /api/v1/imports/:batchId/execute`)
- Recruiter scoping: Recruiters can execute only batches they uploaded; Admins can execute any batch.
- Sets batch status to `processing`.
- Streams rows in chunks of 50.
- For each row:
  - Validates fields using `csvRowSchema` (full name required, valid email format, phone regex).
  - Checks duplicate email within the same CSV batch.
  - Checks duplicate email against existing PostgreSQL `candidates`.
  - Inserts valid candidates with `import_batch_id` foreign key.
  - Records failed rows with specific field error messages in `error_summary JSONB`.
- Updates batch progress counts and marks status as `completed`.
- Logs `CSV_BATCH_PROCESSED` event in `audit_logs`.

### 3.3 CSV Preview & Duplicate Detection Flow (`POST /api/v1/imports/csv/preview`)
- Primary Route: `POST /api/v1/imports/csv/preview` (Alias: `POST /api/v1/imports/preview`).
- Roles: `admin`, `recruiter` (Reviewers receive HTTP 403).
- Dual Input Support: Direct multipart CSV file upload or secure reference to existing batch `{ batchId: "<uuid>" }`.
- Duplicate Detection:
  - Case-insensitive, trimmed email comparison.
  - Excludes soft-deleted candidates (`deleted_at IS NULL`).
  - Detects duplicate emails within the CSV file (`DUPLICATE_IN_CSV`) and tracks first seen row number.
  - Parameterized batched PostgreSQL query using `LOWER(email) = ANY($1::text[])` to eliminate N+1 queries.
- Row Classification:
  - `NEW`: Valid candidate row, not duplicate in CSV or database.
  - `INVALID`: Row fails field/schema validation (e.g. missing name, invalid email).
  - `DUPLICATE_IN_DATABASE`: Candidate email already exists in PostgreSQL database.
  - `DUPLICATE_IN_CSV`: Candidate email repeated earlier in the same CSV upload.
- Privacy Preservation: Exposes only row outcome, status, and candidate ID; no personal data from existing records is leaked.

### 3.4 Confirm & Import Candidates Flow (`POST /api/v1/imports/:importId/confirm`)
- Route: `POST /api/v1/imports/:importId/confirm`.
- Roles: `admin`, `recruiter` (owning recruiter or admin; reviewers receive HTTP 403).
- Explicit Confirmation: Requires `{ "confirm": true }` in JSON body.
- Idempotent Execution: Repeating confirmation for an already completed batch returns the existing summary without re-inserting candidates.
- Atomic Concurrency Lock: Claims batch using conditional `UPDATE import_batches SET status = 'processing' WHERE id = $1 AND status = 'pending'`, preventing simultaneous processing races.
- Database Transaction:
  - Pure atomic execution inside `BEGIN ... COMMIT ... ROLLBACK`.
  - Immediate recheck of duplicates before each insert prevents race conditions.
  - Inserts only eligible rows classified as `NEW`.
  - Skips invalid rows, CSV duplicates, and database duplicates without crashing.
  - Updates `import_batches` with row outcomes and completion timestamp.
  - Clean transaction rollback on unexpected errors.
- Audit Trail: Immutable event `CSV_IMPORT_CONFIRMED` logged with summary metrics.

---

## 4. Verification Workflow Engine

### 4.1 Strict Separation of Duties
- **Recruiters:** Can create candidates, add credential claims, and create verification tasks. Recruiters are **strictly forbidden** from accessing the reviewer queue or verifying/passing claims (HTTP 403).
- **Reviewers:** Can access the verification review queue, inspect candidate claims and resume extraction reports, and submit review decisions (`passed`, `failed`, `requires_review`). Reviewers cannot manage roles or upload CSV batches.
- **Admins:** Global oversight. Can reassign tasks, override reviews, and execute all actions.

### 4.2 Credential Claims Management
- Endpoint: `POST /api/v1/candidates/:id/claims`
- Supported Claim Types: `education`, `employment`, `identity`, `criminal_check`, `certification`, `reference`.
- Statuses: `unverified` -> `verified`, `discrepant`, `inconclusive`.

### 4.3 Prioritized Verification Queue
- Endpoint: `GET /api/v1/verifications`
- Priority Ordering: `urgent` (1), `high` (2), `normal` (3), `low` (4), followed by creation date.
- Scoping: Reviewers see tasks assigned to them or unassigned open tasks; Admins see all tasks globally.

### 4.4 Review Decision & Status Synchronization
- Endpoint: `POST /api/v1/verifications/:id/review`
- Mandatory Reviewer Notes (minimum 5 characters).
- Automatic Status Synchronization:
  - If review is `passed`: claim status updates to `verified`.
  - If review is `failed`: claim status updates to `discrepant`, candidate status updates to `flagged`.
  - If all claims/verifications pass: candidate status updates to `verified`.
- Logs `VERIFICATION_REVIEW_SUBMITTED` in `audit_logs`.

### 4.5 Candidate Verification Workflow Engine (Step 5)
- **Endpoint:** `POST /api/v1/candidates/:candidateId/verifications`
- **Roles Allowed:** `admin`, `recruiter` (`reviewer` strictly forbidden with HTTP 403)
- **Preconditions:**
  - Candidate exists and is not soft-deleted (`deleted_at IS NULL`).
  - Recruiter access is verified via resource authorization (`canAccessCandidate`).
  - Candidate must have at least one uploaded resume document in `documents` (otherwise 400 Bad Request).
  - No active verification currently in progress (`pending` or `requires_review`; otherwise 409 Conflict).
- **Automated Screening Execution:**
  - Extracts text from latest uploaded candidate resume (`resume_extractions`).
  - Runs 10 deterministic rule-based screening checks:
    1. `EMPTY_OR_UNREADABLE_DOCUMENT`: Insufficient or unreadable text (< 50 chars).
    2. `NAME_NOT_FOUND`: Candidate name not detected in resume text.
    3. `EMAIL_MISMATCH`: Candidate email not found in resume text.
    4. `PHONE_NOT_DETECTED`: Candidate phone number not detected in resume text.
    5. `EDUCATION_SECTION_MISSING`: No recognized education keywords/credentials found.
    6. `EXPERIENCE_SECTION_MISSING`: No recognized work experience keywords found.
    7. `INVALID_DATE_RANGE`: Inverted chronological range (end year precedes start year).
    8. `FUTURE_DATE_ANOMALY`: Future year reference (> current year + 2).
    9. `UNCONVENTIONAL_DATE_FORMAT`: Absence of standard ISO or spelled-out month date patterns.
    10. `INCOMPLETE_CONTACT_METADATA`: Incomplete contact information.
- **Rerun Idempotency:**
  - Safely deletes any prior issues linked to the verification ID (`validationIssueRepository.deleteByVerificationId`) before persisting new issues.
- **Status Progression:**
  - If issues count > 0: verification status transitions to `requires_review`.
  - If issues count = 0: verification status transitions to `passed`.
  - Candidate status transitions to `in_progress` if currently `pending`.
- **Result Retrieval APIs:**
  - `GET /api/v1/candidates/:candidateId/verifications`: List candidate verifications.
  - `GET /api/v1/verifications/:verificationId`: Get verification details.
  - `GET /api/v1/verifications/:verificationId/issues`: Paginated validation issues for verification.

---

### 4.5 Reviewer Assignment & Review Workflow (Step 6)

#### Reviewer Assignment (`POST /api/v1/verifications/:verificationId/assign`)
- **Roles:** `admin`, `recruiter` (Reviewers receive HTTP 403 Forbidden).
- **Authorization Scoping:**
  - Admins can assign any verification task.
  - Recruiters can assign only tasks for candidates they created (`canAccessCandidate` ownership enforcement).
- **Reviewer Validation:**
  - Checks reviewer user exists, is active (`is_active = true`), and has the `reviewer` role assigned via `user_roles`.
- **Preconditions & Guards:**
  - Verifications with terminal status (`passed` or `failed`) cannot be reassigned (HTTP 400 Bad Request).
  - Verifications already assigned to the same reviewer return HTTP 409 Conflict.
- **Transactional Update & Audit:**
  - Atomic update of `verifications.reviewer_id`, `verifications.assigned_at`, `priority`, and `notes`.
  - Records `VERIFICATION_ASSIGNED` event in `audit_logs` within the same transaction.

#### Reviewer Queue (`GET /api/v1/reviewer/assignments`)
- **Roles:** `reviewer` (Recruiters receive HTTP 403 Forbidden).
- **Strict User Scoping:**
  - Reviewers can query ONLY verifications explicitly assigned to their user ID (`WHERE reviewer_id = req.user.id`).
  - Supports pagination (`page`, `limit`) and filtering by `status`.

#### Assignment Inspection (`GET /api/v1/reviewer/assignments/:verificationId`)
- **Roles:** `reviewer`.
- **Ownership Scoping:**
  - Returns HTTP 403 Forbidden if `verification.reviewer_id !== req.user.id`.
- **Response Aggregation & Privacy Guard:**
  - Candidate profile (safe fields).
  - Resume document metadata with safe download URL (`/download`) — internal file paths, storage keys, and sensitive tokens are completely hidden.
  - Automated screening summary (severity counts, issue counts).
  - Validation issues list.
  - Immutable audit history of assignment and prior reviews.

#### Review Decision Submission (`POST /api/v1/reviewer/assignments/:verificationId/decision`)
- **Roles:** `reviewer` (Recruiters receive HTTP 403 Forbidden).
- **Preconditions & Rules:**
  - Caller must be the assigned reviewer (`verification.reviewer_id === req.user.id`).
  - Unassigned tasks cannot be decided upon (HTTP 400 Bad Request).
  - Repeated identical decision on an already finalized verification returns HTTP 409 Conflict.
  - **Conflict of Interest Policy:** Reviewers are strictly forbidden from reviewing candidates created by themselves or matching their own email address (HTTP 403 Forbidden).
  - **Decision Types:** `APPROVED`, `REJECTED`, `NEEDS_INFORMATION`.
  - For `REJECTED` and `NEEDS_INFORMATION`, an explanatory reason of at least 5 characters is strictly required (HTTP 400 Bad Request).
- **Database Status Synchronization (Transactional):**
  - Verification Status:
    - `APPROVED` -> `passed`
    - `REJECTED` -> `failed`
    - `NEEDS_INFORMATION` -> `requires_review`
  - Associated Claims:
    - Linked `candidate_claims` status updated to `verified`, `rejected`, or `flagged`.
  - Candidate Overall Status:
    - `APPROVED` -> `verified` (if no other pending verifications remain) or `in_progress`.
    - `REJECTED` -> `flagged`.
    - `NEEDS_INFORMATION` -> `in_progress`.
  - Audit Trail:
    - Records `VERIFICATION_DECISION_SUBMITTED` with decision, notes, candidate ID, and actor ID in `audit_logs`.

---

## 5. API Reference Table

| Method | Endpoint | Allowed Roles | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/imports/upload` | Admin, Recruiter | Upload CSV file, store securely, and return header mapping & preview |
| `POST` | `/api/v1/imports/csv/preview` | Admin, Recruiter | Preview CSV and detect duplicates (DB and CSV duplicates, case-insensitive) |
| `POST` | `/api/v1/imports/:importId/confirm` | Admin, Recruiter | Transactionally confirm and import eligible NEW candidates into PostgreSQL |
| `POST` | `/api/v1/imports/:batchId/execute` | Admin, Recruiter | Ingest CSV rows with chunking, validation, and error tracking |
| `GET` | `/api/v1/imports/:batchId` | Admin, Recruiter | Get batch status, progress counts, and error summary |
| `GET` | `/api/v1/imports` | Admin, Recruiter | List import batches with pagination |
| `POST` | `/api/v1/candidates/:candidateId/verifications` | Admin, Recruiter | Initiate automated candidate verification workflow |
| `GET` | `/api/v1/candidates/:candidateId/verifications` | Admin, Recruiter, Reviewer | List verifications for candidate |
| `GET` | `/api/v1/verifications/:id` | Admin, Recruiter, Reviewer | Get single verification details |
| `GET` | `/api/v1/verifications/:id/issues` | Admin, Recruiter, Reviewer | Get paginated validation issues for verification |
| `POST` | `/api/v1/verifications/:id/assign` | Admin, Recruiter | Assign verification task to active reviewer with ownership check |
| `GET` | `/api/v1/reviewer/assignments` | Reviewer | Get current reviewer's assigned verification queue |
| `GET` | `/api/v1/reviewer/assignments/:id` | Reviewer | Get full candidate verification context, safe resume URL, issues, and history |
| `POST` | `/api/v1/reviewer/assignments/:id/decision` | Reviewer | Submit review decision (APPROVED, REJECTED, NEEDS_INFO) with conflict check |
| `POST` | `/api/v1/candidates/:id/claims` | Admin, Recruiter | Add credential claim to candidate profile |
| `GET` | `/api/v1/candidates/:id/claims` | Admin, Recruiter, Reviewer | List candidate credential claims |
| `POST` | `/api/v1/verifications` | Admin, Recruiter | Create verification task with priority and optional reviewer |
| `GET` | `/api/v1/verifications` | Admin, Reviewer | Prioritized verification review queue (Recruiters forbidden) |
| `PATCH` | `/api/v1/verifications/:id/assign` | Admin | Assign or reassign verification task to a reviewer |
| `POST` | `/api/v1/verifications/:id/review` | Admin, Reviewer | Submit review decision with notes (Recruiters forbidden) |

---

## 6. Audit Trail

Every Phase 9 event is immutably recorded in `audit_logs`:
- `CSV_BATCH_UPLOADED`: Uploaded file name, storage key, SHA-256 hash, and total row count.
- `CSV_IMPORT_CONFIRMED`: Import ID, total rows, inserted count, skipped counts, and completion timestamp.
- `CSV_BATCH_PROCESSED`: Successful rows, failed rows, and error count.
- `CANDIDATE_VERIFICATION_INITIATED`: Candidate ID, document ID, status, priority, and total issues detected.
- `VERIFICATION_ASSIGNED`: Assigning user ID, verification ID, candidate ID, target reviewer ID, and previous reviewer ID.
- `VERIFICATION_DECISION_SUBMITTED`: Reviewer ID, verification ID, candidate ID, decision (`APPROVED`, `REJECTED`, `NEEDS_INFORMATION`), resulting status, and notes.
- `CLAIM_CREATED`: Candidate ID, claim type, organization, and degree/title.
- `VERIFICATION_CREATED`: Candidate ID, claim ID, priority, and assigned reviewer.
- `VERIFICATION_REVIEW_SUBMITTED`: Review status decision, notes, and reviewer ID.
