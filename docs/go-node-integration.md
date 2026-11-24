# Go Auth + Node.js Integration Architecture

This document describes the secure service-to-service communication between the **Go Authentication & Session Service** (port 8080) and the **Node.js Express API** (port 3000).

---

## 1. Architectural Overview

```
   ┌─────────────────────────────────────────────────────────────┐
   │                         Client Browser                      │
   └──────────────────────────────┬──────────────────────────────┘
                                  │
         1. Google OAuth & Login  │  2. Authenticated API Requests
            Cookie Issuance       │     Cookie: cvs_session=<token>
                                  │
                                  ▼
   ┌──────────────────────────────┬──────────────────────────────┐
   │  Go Auth Service (Port 8080) │  Node.js API (Port 3000)     │
   │                              │                              │
   │  • Google OAuth 2.0 + OIDC   │  • Candidate Management      │
   │  • Session Creation/Hashing  │  • CSV Processing Engine     │
   │  • Token Rotation & Logout   │  • Verification Workflows    │
   │  • POST /internal/session/validate                          │
   │         ▲                    │         │                    │
   │         │                    │         │ authenticate       │
   │         │                    ▼         │ middleware         │
   │         │       3. Internal HTTP POST  │                    │
   │         └──────────────────────────────┘                    │
   │            X-Internal-Secret: <SECRET>                      │
   │            Body: {"session_token": "<token>"}               │
   └──────────────────────────────┬──────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────┐
   │             PostgreSQL 18.7 (candidate_verification)        │
   │       • users  • roles  • user_roles  • sessions            │
   └─────────────────────────────────────────────────────────────┘
```

---

## 2. Authentication & Authorization Flow

1. **User Authentication (Go Auth)**:
   - User navigates to `GET http://localhost:8080/auth/google/login`.
   - Go Auth performs Google OAuth 2.0 PKCE flow and verifies the ID token with Google's OIDC discovery keys.
   - User is synchronized in the PostgreSQL `users` table.
   - A 256-bit cryptographically random token is generated. Only its SHA-256 hash is stored in `sessions`.
   - Go Auth issues an `HttpOnly`, `SameSite=Lax`, `Path=/` cookie named `cvs_session`.

2. **Protected API Request (Node.js)**:
   - Client sends request to Node.js (e.g. `GET /api/v1/auth/me`) with `cvs_session` cookie (or `Authorization: Bearer <token>`).
   - The Express `authenticate` middleware intercepts the request.
   - If no token is provided, the middleware immediately returns `401 Unauthorized`.

3. **Internal Session Validation Bridge**:
   - Node.js `GoAuthClient` makes an internal POST request to:
     `POST ${GO_AUTH_INTERNAL_URL}/internal/session/validate`
   - Node.js includes the `X-Internal-Secret` header containing `INTERNAL_SERVICE_SECRET`.
   - Go Auth verifies the secret using constant-time string comparison (`crypto/subtle.ConstantTimeCompare`) to prevent timing attacks.
   - Go Auth computes `SHA-256(session_token)`, looks up the session in PostgreSQL, verifies expiration and revocation (`revoked_at IS NULL`), and loads the user profile with assigned roles.
   - Go Auth returns the verified identity.

4. **Context Attachment & Execution**:
   - Node.js attaches the verified user context to `req.user`.
   - The route handler executes with verified role context.
   - If Go Auth is unreachable or times out, Node.js returns `503 Service Unavailable`.
   - If the session is invalid, expired, or revoked, Node.js returns `401 Unauthorized`.

---

## 3. Internal API Contract

### Request: `POST /internal/session/validate`

**Headers:**
```http
Content-Type: application/json
X-Internal-Secret: <INTERNAL_SERVICE_SECRET>
```

**Body:**
```json
{
  "session_token": "a4f8c2e1..."
}
```

### Responses

#### 1. Valid Session (HTTP 200)
```json
{
  "valid": true,
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "recruiter@example.com",
  "name": "Jane Recruiter",
  "roles": ["recruiter"],
  "session_id": "770e8400-e29b-41d4-a716-446655440002",
  "expires_at": "2026-11-30T12:00:00Z"
}
```

#### 2. Expired, Revoked, or Invalid Token (HTTP 401)
```json
{
  "valid": false,
  "error": "session_expired_or_revoked"
}
```

#### 3. Unauthorized Internal Secret (HTTP 401)
```json
{
  "valid": false,
  "error": "unauthorized_service_call"
}
```

#### 4. Missing Session Token (HTTP 400)
```json
{
  "valid": false,
  "error": "missing_session_token"
}
```

---

## 4. Protected Public Endpoint: `GET /api/v1/auth/me`

Returns sanitized authenticated user details and active session metadata. Never returns raw tokens, internal secrets, or Google refresh tokens.

### Success Response (HTTP 200):
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "recruiter@example.com",
      "name": "Jane Recruiter",
      "roles": ["recruiter"]
    },
    "session": {
      "id": "770e8400-e29b-41d4-a716-446655440002",
      "expiresAt": "2026-11-30T12:00:00Z"
    }
  },
  "meta": {
    "timestamp": "2026-11-23T12:00:00.000Z",
    "version": "v1"
  }
}
```

---

## 5. Environment Configuration

### Go Auth (`go-auth/.env`):
```dotenv
SERVER_PORT=8080
DATABASE_URL=postgres://postgres:PASSWORD@localhost:5432/candidate_verification?sslmode=disable
INTERNAL_SERVICE_SECRET=dev-internal-secret-candidate-verification-2026-key
SESSION_TTL_HOURS=168
COOKIE_SECURE=false
```

### Node.js API (`node-api/.env`):
```dotenv
PORT=3000
NODE_ENV=development
DATABASE_URL=postgres://postgres:PASSWORD@localhost:5432/candidate_verification
GO_AUTH_INTERNAL_URL=http://localhost:8080
INTERNAL_SERVICE_SECRET=dev-internal-secret-candidate-verification-2026-key
```

---

## 6. How to Run Both Services

### Terminal 1: Go Auth Service (Port 8080)
```powershell
cd D:\CandidateVerificationSystem\go-auth
go run ./cmd/server
```

### Terminal 2: Node.js API (Port 3000)
```powershell
cd D:\CandidateVerificationSystem\node-api
npm run dev
```

---

## 7. How to Test Authenticated Requests

### Option A: Using the Browser
1. Log in via Google: [http://localhost:8080/auth/google/login](http://localhost:8080/auth/google/login).
2. The browser receives the `cvs_session` cookie.
3. Visit [http://localhost:3000/api/v1/auth/me](http://localhost:3000/api/v1/auth/me).
4. Node.js validates the cookie with Go Auth and renders your authenticated user profile.

### Option B: Using cURL / PowerShell
```powershell
# 1. Inspect without authentication (returns 401 Unauthorized):
curl http://localhost:3000/api/v1/auth/me

# 2. Inspect with session cookie:
curl -H "Cookie: cvs_session=<RAW_SESSION_TOKEN>" http://localhost:3000/api/v1/auth/me

# 3. Inspect with Bearer token header:
curl -H "Authorization: Bearer <RAW_SESSION_TOKEN>" http://localhost:3000/api/v1/auth/me
```
