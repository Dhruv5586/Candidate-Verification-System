# Candidate Verification System — API Documentation

Interactive OpenAPI 3.0 Documentation is available at `http://localhost:3000/api/v1/docs` (JSON spec at `/api/v1/docs/json`).

---

## Base URL
`http://localhost:3000/api/v1`

---

## Authentication & Authorization
- **Session Cookie:** `cvs_session=<session_token>`
- **Authorization Header:** `Bearer <session_token>`
- **Roles:** `admin`, `recruiter`, `reviewer`

---

## Phase 9 Bulk CSV Ingestion Endpoints

### 1. Upload CSV File
- **Endpoint:** `POST /api/v1/imports/upload`
- **Roles Allowed:** `admin`, `recruiter`
- **Content-Type:** `multipart/form-data`
- **Fields:** `file` (CSV file, max 5MB)
- **Response (201 Created):**
  ```json
  {
    "success": true,
    "data": {
      "batchId": "b0000000-0000-0000-0000-000000001001",
      "fileName": "candidates.csv",
      "fileSizeBytes": 1024,
      "checksumSha256": "4b70c1...",
      "detectedHeaders": ["Full Name", "Email Address", "Phone Number", "City", "Job Title"],
      "totalRows": 25,
      "sampleRows": [ ... ]
    }
  }
  ```

---

### 2. CSV Preview & Duplicate Detection (Step 3)
- **Endpoint:** `POST /api/v1/imports/csv/preview` (Alias: `POST /api/v1/imports/preview`)
- **Roles Allowed:** `admin`, `recruiter`
- **Content-Type:** `multipart/form-data` OR `application/json`
- **Body Options:**
  - `file`: Direct CSV upload
  - `{ "batchId": "<uuid>" }`: Reference to previously uploaded batch
  - `{ "csvContent": "<csv text>" }`: Direct CSV string
- **Duplicate Detection Rules:**
  - Email case-insensitive and whitespace trimmed.
  - Excludes soft-deleted candidates (`deleted_at IS NULL`).
  - Classifies rows into `NEW`, `INVALID`, `DUPLICATE_IN_DATABASE`, `DUPLICATE_IN_CSV`.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "importId": "b0000000-0000-0000-0000-000000001001",
      "batchId": "b0000000-0000-0000-0000-000000001001",
      "totalRows": 10,
      "validRows": 8,
      "invalidRows": 2,
      "newCandidates": 6,
      "existingDatabaseDuplicates": 1,
      "duplicateRowsWithinCsv": 1,
      "skippedRows": 4,
      "rows": [
        {
          "rowNumber": 2,
          "status": "NEW",
          "issues": [],
          "data": {
            "fullName": "Alice Smith",
            "email": "alice.smith@example.com",
            "phone": "+1-555-0101",
            "location": "Seattle",
            "currentJobTitle": "Software Engineer"
          }
        },
        {
          "rowNumber": 3,
          "status": "DUPLICATE_IN_DATABASE",
          "issues": ["Candidate with email 'john.doe@example.com' already exists in database"],
          "data": { ... },
          "duplicateInfo": {
            "candidateId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
            "existingStatus": "verified",
            "matchedEmail": "john.doe@example.com"
          }
        }
      ]
    }
  }
  ```

---

### 3. Confirm & Import Candidates (Step 4)
- **Endpoint:** `POST /api/v1/imports/:importId/confirm`
- **Roles Allowed:** `admin`, `recruiter` (owning recruiter or admin)
- **Content-Type:** `application/json`
- **Request Body:**
  ```json
  {
    "confirm": true
  }
  ```
- **Rules & Guarantees:**
  - Explicit confirmation required (`confirm: true`).
  - Idempotent: repeated confirmation of an already completed batch returns the existing summary without re-inserting candidates.
  - Concurrency Lock: atomic conditional status update (`UPDATE import_batches SET status = 'processing' WHERE id = $1 AND status = 'pending'`).
  - Database Transaction: `BEGIN`, duplicate recheck, candidate `INSERT`, batch status `completed`, `COMMIT`.
  - Rolls back cleanly on failure.
  - Skips invalid rows, CSV duplicates, and database duplicates.
  - Never overwrites existing candidates.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "importId": "b0000000-0000-0000-0000-000000001001",
      "status": "completed",
      "totalRows": 10,
      "insertedCount": 6,
      "skippedInvalidCount": 2,
      "skippedDatabaseDuplicateCount": 1,
      "skippedCsvDuplicateCount": 1,
      "failedCount": 0,
      "completedAt": "2026-11-23T11:45:00.000Z",
      "rowOutcomes": [
        {
          "rowNumber": 2,
          "status": "INSERTED",
          "email": "alice.smith@example.com",
          "fullName": "Alice Smith",
          "candidateId": "8f8b6312-3f19-43a9-a9a7-96a5f013d4b8"
        },
        {
          "rowNumber": 3,
          "status": "SKIPPED_DATABASE_DUPLICATE",
          "email": "john.doe@example.com",
          "fullName": "John Doe",
          "candidateId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
          "reason": "Candidate with email 'john.doe@example.com' already exists in database"
        }
      ]
    }
  }
  ```

---

### 4. Candidate Verification Workflow (Step 5)

#### 4.1 Initiate Candidate Verification
- **Endpoint:** `POST /api/v1/candidates/:candidateId/verifications`
- **Roles Allowed:** `admin`, `recruiter` (`reviewer` receives HTTP 403 Forbidden)
- **Preconditions:**
  - Candidate exists and is not soft-deleted (`deleted_at IS NULL`).
  - Recruiter can only verify candidates they created (admins can verify any candidate).
  - Candidate must have at least one uploaded resume in `documents` (otherwise returns 400 Bad Request).
  - No active verification currently in progress (`pending` or `requires_review`; otherwise returns 409 Conflict).
- **Automated Screening:**
  - Evaluates extracted resume text using 10 screening rules:
    - `EMPTY_OR_UNREADABLE_DOCUMENT`: Insufficient or unreadable text.
    - `NAME_NOT_FOUND`: Candidate name not identified.
    - `EMAIL_MISMATCH`: Registered email not found in document.
    - `PHONE_NOT_DETECTED`: Candidate phone number not detected.
    - `EDUCATION_SECTION_MISSING`: Missing academic or degree section.
    - `EXPERIENCE_SECTION_MISSING`: Missing employment or career history.
    - `INVALID_DATE_RANGE`: Inverted chronological date range (e.g., 2024 - 2018).
    - `FUTURE_DATE_ANOMALY`: Anomalous future year references (> current year + 2).
    - `UNCONVENTIONAL_DATE_FORMAT`: No recognized ISO or spelled month date patterns.
    - `INCOMPLETE_CONTACT_METADATA`: Profile missing standard contact metadata.
  - Generates validation issues recorded in `validation_issues` linked to the verification ID.
  - Automatically sets verification status to `requires_review` if any issues are detected, or `passed` if clean.
  - Transitions candidate status to `in_progress` if currently `pending`.
  - Records an immutable audit event: `CANDIDATE_VERIFICATION_INITIATED`.
- **Request Body (JSON, Optional):**
  ```json
  {
    "priority": "high",
    "notes": "Fast-track verification for senior hire"
  }
  ```
- **Response (201 Created):**
  ```json
  {
    "success": true,
    "data": {
      "id": "30010000-0000-0000-0000-000000000099",
      "candidate_id": "10010000-0000-0000-0000-000000000001",
      "status": "requires_review",
      "priority": "high",
      "total_issues": 1,
      "issues": [
        {
          "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
          "severity": "low",
          "issue_type": "PHONE_NOT_DETECTED",
          "description": "Registered phone number '+1-555-0123' was not detected in the resume text.",
          "status": "open"
        }
      ],
      "created_at": "2026-11-23T11:50:00.000Z"
    },
    "meta": { "timestamp": "2026-11-23T11:50:00.000Z" }
  }
  ```

#### 4.2 List Verifications for Candidate
- **Endpoint:** `GET /api/v1/candidates/:candidateId/verifications`
- **Roles Allowed:** `admin`, `recruiter` (resource-scoped), `reviewer`
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "30010000-0000-0000-0000-000000000099",
        "candidate_id": "10010000-0000-0000-0000-000000000001",
        "claim_id": null,
        "reviewer_id": null,
        "status": "requires_review",
        "priority": "high",
        "notes": "Automated verification completed: 1 screening issue(s) detected",
        "created_at": "2026-11-23T11:50:00.000Z"
      }
    ],
    "meta": { "total": 1, "timestamp": "2026-11-23T11:50:00.000Z" }
  }
  ```

#### 4.3 Get Verification Details
- **Endpoint:** `GET /api/v1/verifications/:verificationId`
- **Roles Allowed:** `admin`, `recruiter` (resource-scoped), `reviewer`
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "id": "30010000-0000-0000-0000-000000000099",
      "candidate_id": "10010000-0000-0000-0000-000000000001",
      "claim_id": null,
      "reviewer_id": null,
      "status": "requires_review",
      "priority": "high",
      "notes": "Automated verification completed: 1 screening issue(s) detected",
      "created_at": "2026-11-23T11:50:00.000Z"
    },
    "meta": { "timestamp": "2026-11-23T11:50:00.000Z" }
  }
  ```

#### 4.4 Get Verification Validation Issues (Paginated)
- **Endpoint:** `GET /api/v1/verifications/:verificationId/issues?page=1&limit=20`
- **Roles Allowed:** `admin`, `recruiter` (resource-scoped), `reviewer`
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        "verification_id": "30010000-0000-0000-0000-000000000099",
        "candidate_id": "10010000-0000-0000-0000-000000000001",
        "document_id": "40010000-0000-0000-0000-000000000004",
        "issue_type": "PHONE_NOT_DETECTED",
        "severity": "low",
        "description": "Registered phone number '+1-555-0123' was not detected in the resume text.",
        "resolved": false,
        "status": "open",
        "created_at": "2026-11-23T11:50:00.000Z"
      }
    ],
    "pagination": {
      "total": 1,
      "page": 1,
      "limit": 20,
      "totalPages": 1
    },
    "meta": { "total": 1, "timestamp": "2026-11-23T11:50:00.000Z" }
  }
  ```

---

### 5. Reviewer Assignment & Review Workflow (Step 6)

#### 5.1 Assign Reviewer to Verification
- **Endpoint:** `POST /api/v1/verifications/:verificationId/assign`
- **Roles Allowed:** `admin`, `recruiter` (`reviewer` strictly forbidden with HTTP 403)
- **Preconditions:**
  - Recruiter can only assign verifications for candidates they created (resource-scoped ownership).
  - Target user must exist, be active (`is_active = true`), and possess the `reviewer` role (otherwise 400 Bad Request).
  - Cannot assign already completed/terminal verifications (`status IN ('passed', 'failed')` -> 400 Bad Request).
  - Cannot assign to the same reviewer if already assigned (409 Conflict).
- **Request Body (`application/json`):**
  ```json
  {
    "reviewerId": "20010000-0000-0000-0000-000000000002",
    "priority": "high",
    "notes": "Please verify educational credentials urgently"
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "id": "30010000-0000-0000-0000-000000000099",
      "candidate_id": "10010000-0000-0000-0000-000000000001",
      "reviewer_id": "20010000-0000-0000-0000-000000000002",
      "status": "requires_review",
      "priority": "high",
      "assigned_at": "2026-11-23T12:00:00.000Z",
      "notes": "Please verify educational credentials urgently"
    },
    "meta": { "timestamp": "2026-11-23T12:00:00.000Z" }
  }
  ```

#### 5.2 Get Reviewer Assigned Verifications Queue
- **Endpoint:** `GET /api/v1/reviewer/assignments?page=1&limit=20&status=requires_review`
- **Roles Allowed:** `reviewer` (`recruiter` strictly forbidden with HTTP 403)
- **Scoping:** Strictly returns only verifications assigned to the calling reviewer (`reviewer_id = req.user.id`).
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "30010000-0000-0000-0000-000000000099",
        "candidate_id": "10010000-0000-0000-0000-000000000001",
        "claim_id": null,
        "reviewer_id": "20010000-0000-0000-0000-000000000002",
        "status": "requires_review",
        "priority": "high",
        "assigned_at": "2026-11-23T12:00:00.000Z",
        "candidate_name": "Jane Doe",
        "candidate_email": "jane.doe@example.com",
        "candidate_status": "in_progress",
        "created_at": "2026-11-23T11:50:00.000Z"
      }
    ],
    "pagination": {
      "total": 1,
      "page": 1,
      "limit": 20,
      "totalPages": 1
    },
    "meta": { "total": 1, "timestamp": "2026-11-23T12:05:00.000Z" }
  }
  ```

#### 5.3 Get Detailed Review Assignment
- **Endpoint:** `GET /api/v1/reviewer/assignments/:verificationId`
- **Roles Allowed:** `reviewer`
- **Scoping:** Returns 403 Forbidden if verification is not assigned to the calling reviewer.
- **Data Protection:** Resume storage paths are completely redacted; only safe, authenticated download URLs are exposed.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "verification": {
        "id": "30010000-0000-0000-0000-000000000099",
        "candidate_id": "10010000-0000-0000-0000-000000000001",
        "reviewer_id": "20010000-0000-0000-0000-000000000002",
        "status": "requires_review",
        "priority": "high",
        "assigned_at": "2026-11-23T12:00:00.000Z",
        "notes": "Automated verification completed: 1 screening issue(s) detected"
      },
      "candidate": {
        "id": "10010000-0000-0000-0000-000000000001",
        "full_name": "Jane Doe",
        "email": "jane.doe@example.com",
        "phone": "+1-555-0123",
        "location": "New York, NY",
        "current_job_title": "Senior Engineer",
        "status": "in_progress"
      },
      "resume": {
        "documentId": "40010000-0000-0000-0000-000000000004",
        "fileName": "resume.pdf",
        "fileSizeBytes": 10240,
        "mimeType": "application/pdf",
        "downloadUrl": "/api/v1/candidates/10010000-0000-0000-0000-000000000001/documents/40010000-0000-0000-0000-000000000004/download"
      },
      "validationSummary": {
        "totalIssues": 1,
        "highSeverity": 0,
        "mediumSeverity": 0,
        "lowSeverity": 1,
        "status": "requires_review"
      },
      "validationIssues": [
        {
          "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
          "issue_type": "PHONE_NOT_DETECTED",
          "severity": "low",
          "description": "Registered phone number '+1-555-0123' was not detected in the resume text.",
          "status": "open"
        }
      ],
      "reviewHistory": [
        {
          "id": "50010000-0000-0000-0000-000000000005",
          "action": "VERIFICATION_ASSIGNED",
          "actor_id": "20010000-0000-0000-0000-000000000001",
          "details": { "assigned_to": "20010000-0000-0000-0000-000000000002" },
          "created_at": "2026-11-23T12:00:00.000Z"
        }
      ]
    },
    "meta": { "timestamp": "2026-11-23T12:05:00.000Z" }
  }
  ```

#### 5.4 Submit Review Decision
- **Endpoint:** `POST /api/v1/reviewer/assignments/:verificationId/decision`
- **Roles Allowed:** `reviewer` (`recruiter` strictly forbidden with HTTP 403)
- **Preconditions:**
  - Caller must be assigned to this verification (`verification.reviewer_id === req.user.id`).
  - Conflict of interest check: Caller cannot review candidates created by themselves or matching their own email (403 Forbidden).
  - Decision must be one of: `APPROVED`, `REJECTED`, `NEEDS_INFORMATION`.
  - For `REJECTED` and `NEEDS_INFORMATION`, a reason/comment of at least 5 characters is mandatory (400 Bad Request).
  - Cannot submit the identical decision on an already-resolved verification (409 Conflict).
- **Request Body (`application/json`):**
  ```json
  {
    "decision": "APPROVED",
    "notes": "All educational credentials and employment history verified successfully."
  }
  ```
- **Status Synchronization:**
  - `APPROVED`: Verification -> `passed`, Candidate -> `verified` (or `in_progress` if other checks remain).
  - `REJECTED`: Verification -> `failed`, Candidate -> `flagged`.
  - `NEEDS_INFORMATION`: Verification -> `requires_review`, Candidate -> `in_progress`.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "id": "30010000-0000-0000-0000-000000000099",
      "candidate_id": "10010000-0000-0000-0000-000000000001",
      "reviewer_id": "20010000-0000-0000-0000-000000000002",
      "status": "passed",
      "verified_at": "2026-11-23T12:10:00.000Z",
      "notes": "All educational credentials and employment history verified successfully."
    },
    "meta": {
      "decision": "APPROVED",
      "timestamp": "2026-11-23T12:10:00.000Z"
    }
  }
  ```

---

### 6. Legacy Verification Queue & Reviews (General Verification APIs)
- `GET /api/v1/verifications`: Review queue prioritized by `urgent` > `high` > `normal` > `low` (Reviewers and Admins only).
- `PATCH /api/v1/verifications/:id/assign`: Assign or reassign verification task (Admin only).
- `POST /api/v1/verifications/:id/review`: Submit review decision (`passed`, `failed`, `requires_review`) with notes (Admin and Reviewers; Recruiters forbidden with 403).
- `POST /api/v1/candidates/:id/claims`: Add verifiable credential claims.
