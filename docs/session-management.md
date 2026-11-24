# Persistent Session Management Architecture

This document describes the design, security properties, and protocol implementation for server-side persistent sessions in the **Candidate Verification System**.

---

## 1. What is a Session?
A session represents an authenticated, continuous state of interaction between an identified user and the application. In contrast to stateless JWTs, persistent database sessions provide:
- **Instant Revocation:** Any session can be terminated immediately upon logout, account deactivation, or security compromise.
- **Auditable Device Tracking:** Each session records client IP addresses, user agents, creation timestamps, and sliding activity windows.
- **Replay & Session Hijacking Mitigation:** Support for atomic token rotation and cryptographic hashing.

---

## 2. Session Token Generation & Storage Security

### A. Token Generation (256-bit Entropy)
- Tokens are produced using Go's cryptographically secure pseudo-random number generator (`crypto/rand`).
- 32 bytes (256 bits) of entropy are encoded into a URL-safe Base64 string (43 characters):
  ```go
  b := make([]byte, 32)
  rand.Read(b)
  token := base64.RawURLEncoding.EncodeToString(b)
  ```
- No predictable identifiers, sequential IDs, or timestamps are embedded into the token.

### B. Why We Store Token Hashes (SHA-256)
- **Zero Plaintext Tokens in Database:** The raw session token is sent **only** to the user's browser in an `HttpOnly` cookie.
- The PostgreSQL `sessions` table stores strictly the **SHA-256 hexadecimal hash** (`token_hash`):
  ```sql
  token_hash VARCHAR(64) NOT NULL UNIQUE
  ```
- **Database Breach Protection:** If the database is compromised, attackers cannot reconstruct active session tokens or impersonate users.
- **Lookup Process:** When a request arrives, the server hashes the cookie token with SHA-256 and executes an indexed lookup (`idx_sessions_token_hash`).

---

## 3. Secure Cookie Management

Cookies are issued via `internal/middleware/session_cookie.go`:

| Cookie Attribute | Production Value | Development Value | Security Purpose |
| :--- | :--- | :--- | :--- |
| **`Name`** | `cvs_session` | `cvs_session` | Standard session cookie identifier. |
| **`HttpOnly`** | `true` | `true` | **Essential XSS Defense:** JavaScript (`document.cookie`) cannot read the token. |
| **`Secure`** | `true` | `false` | Ensures the cookie is only transmitted over HTTPS (disabled on plain `http://localhost`). |
| **`SameSite`** | `Lax` | `Lax` | **CSRF Defense:** Cookie is omitted on third-party cross-site POST requests. |
| **`Path`** | `/` | `/` | Cookie applies system-wide. |
| **`MaxAge`** | 604800 (7 days) | 604800 (7 days) | Deterministic browser cookie lifetime matching session expiration. |

---

## 4. Session Lifecycle & Token Rotation

### A. Login & Session Creation
```mermaid
sequenceDiagram
    autonumber
    actor User as Browser / User
    participant Auth as Go Auth Service
    participant DB as PostgreSQL 18
    participant Front as Frontend (localhost:3000)

    User->>Auth: GET /auth/google/callback?code=...&state=...
    Auth->>Auth: Exchange code, verify ID token & nonce
    Auth->>DB: Upsert user (prevent duplicate Google IDs)
    Auth->>Auth: Generate 256-bit random token & compute SHA-256 hash
    Auth->>DB: INSERT INTO sessions (user_id, token_hash, expires_at)
    Auth->>User: Set-Cookie: cvs_session=<raw_token>; HttpOnly; SameSite=Lax
    Auth->>Front: 302 Redirect to FRONTEND_URL
```

### B. Session Token Rotation (`POST /auth/refresh`)
To prevent token aging and detect token theft, the application supports **atomic token rotation**:
1. User sends `POST /auth/refresh` with current session cookie.
2. The server acquires a row-level lock (`SELECT ... FOR UPDATE`) inside an atomic database transaction.
3. The old token hash is replaced with a fresh token hash, and `expires_at` is extended.
4. If a replayed or duplicate refresh attempt arrives with the old token, it is immediately rejected (`ErrSessionNotFound` or `ErrSessionRevoked`).
5. The new token is set in the client's cookie.

### C. Logout & Revocation (`POST /auth/logout`)
1. User sends `POST /auth/logout`.
2. The server marks `is_revoked = true` and updates `revoked_at = NOW()` in PostgreSQL.
3. The server clears the browser cookie by setting `Max-Age: -1`.
4. Any future requests with that token return `401 Unauthorized`.

---

## 5. Future Node.js Integration (`POST /internal/session/validate`)

In upcoming phases, the **Node.js Express API** will validate incoming candidate verification requests against the Go Auth service:

```
[Client] ---> Bearer Token / Cookie ---> [Node.js Express API]
                                                 |
                                                 | POST /internal/session/validate
                                                 | Header: X-Internal-Secret: <SECRET>
                                                 | Body: { "session_token": "<TOKEN>" }
                                                 v
                                        [Go Auth Service]
                                                 |
                                                 | Hash Token & Query PostgreSQL
                                                 v
                                        [PostgreSQL DB]
                                                 |
                                                 | Return User + Roles
                                                 v
[Client] <--- 200 OK / Response <--- [Node.js Express API]
```

### Protocol Requirements
- **Mutual Secret:** Requires `X-Internal-Secret` matching `INTERNAL_SERVICE_SECRET`.
- **Timing Defense:** Validated using `crypto/subtle.ConstantTimeCompare`.
- **Minimal Response:**
  ```json
  {
    "valid": true,
    "user_id": "78636ef6-b056-4888-845f-98ab567bdec3",
    "email": "recruiter@example.com",
    "name": "Jane Recruiter",
    "roles": ["recruiter"],
    "session_id": "b1820982-fba2-4a0b-9271-923f6c8d76a1",
    "expires_at": "2026-11-30T12:00:00Z"
  }
  ```
- **Zero Token Leakage:** The response never returns raw tokens, hashed secrets, or database credentials.
