# Role-Based Access Control (RBAC) Architecture

This document describes the Role-Based Access Control (RBAC) and resource-level authorization system implemented in Phase 7 for the Candidate Verification System.

---

## 1. Role Definitions & Permissions

The system defines three core roles seeded in PostgreSQL:

| Role | Domain Scope | Permissions |
| :--- | :--- | :--- |
| **`admin`** | Full System Administration | • View all users<br>• Assign/change/remove roles<br>• View all candidate records globally<br>• Manage verification reviewer assignments<br>• Inspect immutable audit logs |
| **`recruiter`** | Candidate Intake & Sourcing | • Create candidate records<br>• View and update authorized candidates<br>• Upload resumes and claims<br>• Initiate automated verifications<br>• View verification outcomes |
| **`reviewer`** | Background Check & Verification | • View assigned candidate records<br>• Inspect submitted resumes & evidence<br>• Review validation discrepancies<br>• Submit verification decisions<br>• Add reviewer notes and comments |

---

## 2. Authentication vs. Authorization Pipeline

Authorization is strictly decoupled from authentication:

1. **Authentication (`requireAuth`)**:
   - Validates the incoming `cvs_session` cookie against the Go Auth service (`POST /internal/session/validate`).
   - Rejects unauthenticated requests with HTTP 401 (`UNAUTHORIZED`).
   - Populates `req.user` with verified identity (`id`, `email`, `name`, `roles`, `sessionId`).

2. **Authorization (`requireRole` / `requireAnyRole`)**:
   - Inspects `req.user`.
   - Cross-references user ID against the PostgreSQL `user_roles` and `roles` tables to verify active role assignments.
   - If the user lacks the required role, the middleware rejects the request with HTTP 403 (`FORBIDDEN`).
   - If authorized, execution passes to the controller handler.

```
Incoming Request
      │
      ▼
requireAuth (HTTP 401 if unauthenticated)
      │
      ▼
requireRole(role) (HTTP 403 if unauthorized)
      │
      ▼
Route Handler / Business Logic
```

---

## 3. Database Schema

The RBAC system utilizes the existing schema from Phase 3:

```sql
-- Core roles table
roles (
    id UUID PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User-to-Role junction table
user_roles (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, role_id)
);

-- Immutable audit logs table
audit_logs (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 4. Role Management & Audit Logging

Role assignment is protected by the following business constraints:

1. **Admin Only:** Only users with the `admin` role can assign or remove roles.
2. **No Self-Assignment:** Administrators cannot modify their own roles, preventing privilege escalation loops.
3. **Transactional Immutability:** Role assignments execute inside a PostgreSQL transaction (`BEGIN ... COMMIT`).
4. **Audit Logging:** Every role modification is recorded in `audit_logs` with:
   - `action`: `ROLE_ASSIGNED`, `ROLE_REMOVED`
   - `user_id`: Admin user who performed the action
   - `entity_type`: `user_role`
   - `entity_id`: Target user ID
   - `old_values` & `new_values`: JSON role lists

---

## 5. Resource-Level Authorization

Beyond role checks, `ResourceAuthorizationService` enforces fine-grained resource ownership:

- **Candidate Access (`canAccessCandidate`)**:
  - `admin`: Global access.
  - `recruiter`: Scoped to candidates owned or within their assigned batch.
  - `reviewer`: Prohibited unless assigned for verification review.

- **Verification Reviews (`canReviewVerification`)**:
  - `admin`: Global oversight.
  - `reviewer`: Permitted only for assigned verifications.
  - `recruiter`: **Strictly forbidden** from submitting verification reviews (separation of duties).

---

## 6. Endpoints

| Method | Endpoint | Protection | Purpose |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/rbac/admin` | `admin` | Admin role verification & permissions inspect |
| `GET` | `/api/v1/rbac/recruiter` | `recruiter` | Recruiter role verification |
| `GET` | `/api/v1/rbac/reviewer` | `reviewer` | Reviewer role verification |
| `POST` | `/api/v1/rbac/roles/assign` | `admin` | Assigns role to user and writes audit log |
