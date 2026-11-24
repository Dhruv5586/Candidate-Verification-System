# Google OAuth 2.0 & OpenID Connect Setup Guide

This guide describes how to configure, run, and test the **Go Authentication Service** in the Candidate Verification System.

---

## 1. Google Cloud Console Configuration

To enable Google login, create an OAuth 2.0 Web Application client in Google Cloud:

1. **Open Google Cloud Console**:
   - Navigate to [https://console.cloud.google.com/](https://console.cloud.google.com/)
   - Create or select your Google Cloud project (e.g., `candidate-verification-system`).

2. **Configure OAuth Consent Screen**:
   - Go to **APIs & Services** > **OAuth consent screen**.
   - Choose User Type: **External** (or **Internal** for Google Workspace organizations).
   - Fill in App Name (e.g., `Candidate Verification System`) and User Support Email.
   - Under **Scopes**, ensure the standard OIDC scopes are selected:
     - `.../auth/userinfo.email` (`email`)
     - `.../auth/userinfo.profile` (`profile`)
     - `openid`
   - Add Test Users if the consent screen is in "Testing" mode.

3. **Create OAuth 2.0 Client Credentials**:
   - Go to **APIs & Services** > **Credentials**.
   - Click **+ CREATE CREDENTIALS** > **OAuth client ID**.
   - Application Type: **Web application**.
   - Name: `Candidate Verification Auth Client`.
   - **Authorized JavaScript origins**:
     - `http://localhost:8080`
     - `http://localhost:3000` (Frontend)
   - **Authorized redirect URIs**:
     - `http://localhost:8080/auth/google/callback`
   - Click **Create**.
   - Copy your **Client ID** and **Client Secret**.

---

## 2. Environment Variables

Create or update `go-auth/.env` based on `.env.example`:

| Variable | Description | Example / Default |
| :--- | :--- | :--- |
| `GOOGLE_CLIENT_ID` | OAuth 2.0 Client ID from Google Cloud Console | `123456789-abc.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 Client Secret from Google Cloud Console | `GOCSPX-xxxxxxxxxxxxxxxx` |
| `GOOGLE_REDIRECT_URL` | Exact redirect URI registered in Google Console | `http://localhost:8080/auth/google/callback` |
| `GOOGLE_ISSUER_URL` | OIDC Issuer Discovery URL | `https://accounts.google.com` |
| `SERVER_PORT` | HTTP Server port | `8080` |
| `FRONTEND_URL` | Client frontend base URL | `http://localhost:3000` |
| `APP_ENV` | Environment name | `development` |

> [!CAUTION]
> **Never commit `.env` or credential files to Git**. The repository's root `.gitignore` enforces exclusion of all `.env*` files except `.env.example`.

---

## 3. Authentication Architecture & Protocol Flow

The service implements **Authorization Code Grant with PKCE (Proof Key for Code Exchange - RFC 7636)** and **OpenID Connect (OIDC)**:

```
[Browser / User]            [Go Auth Service]                 [Google OAuth 2.0 / OIDC]
       |                            |                                    |
       | 1. GET /auth/google/login  |                                    |
       |--------------------------->|                                    |
       |                            | Generate state, nonce, PKCE        |
       |                            | Save tx in in-memory store         |
       | 2. HTTP 302 Redirect       |                                    |
       |<---------------------------|                                    |
       |                                                                 |
       | 3. Redirect to accounts.google.com (state, nonce, S256 challenge)|
       |---------------------------------------------------------------->|
       |                            |                                    |
       | 4. User Consents & Authorizes                                   |
       |                            |                                    |
       | 5. Redirect back with code & state                              |
       |--------------------------->| (GET /auth/google/callback)        |
       |                            |                                    |
       |                            | Validate state & single-use        |
       |                            | 6. Exchange code + PKCE verifier   |
       |                            |----------------------------------->|
       |                            | 7. Return tokens (ID Token + Access)|
       |                            |<-----------------------------------|
       |                            |                                    |
       |                            | Cryptographically verify ID token  |
       |                            | Assert signature, issuer, nonce    |
       |                            | Extract safe user profile          |
       | 8. Return GoogleUser JSON  |                                    |
       |<---------------------------|                                    |
```

### Key Security Safeguards
1. **PKCE S256 (`code_challenge` / `code_verifier`)**: Mitigates authorization code interception attacks.
2. **State Parameter**: Cryptographically random 256-bit token protecting against Cross-Site Request Forgery (CSRF).
3. **Nonce Parameter**: Cryptographically random 256-bit value embedded in the Google ID Token ensuring token replay defense.
4. **Single-Use Enforcement**: Transactions are immediately marked consumed and evicted upon first validation attempt.
5. **No Token Leakage**: The client API returns strictly sanitized user claims (`GoogleSubjectID`, `Email`, `Name`, `Picture`) and never exposes tokens.
6. **HTTP Security Headers**: Injected on all routes (`X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Cache-Control: no-store`).

---

## 4. How to Run Locally

### Prerequisites
- Go 1.22+ installed and available on system `PATH`.
- Valid Google OAuth Client ID and Secret in `go-auth/.env`.

### Step-by-step Execution

1. Navigate to the `go-auth` module:
   ```bash
   cd D:\CandidateVerificationSystem\go-auth
   ```

2. Download and verify Go dependencies:
   ```bash
   go mod tidy
   ```

3. Run automated tests (including mock OIDC validation & RFC 7636 PKCE tests):
   ```bash
   go test -v ./...
   ```

4. Run code vetting:
   ```bash
   go vet ./...
   ```

5. Start the server:
   ```bash
   go run ./cmd/server
   ```
   Output:
   ```text
   [INFO] Starting Candidate Verification System - Go Auth Service (Phase 2)...
   [INFO] Configuration loaded successfully: Config[GoogleClientID=..., ...]
   [INFO] Initializing OIDC provider from issuer: https://accounts.google.com
   [INFO] Go Auth Service listening on port 8080 (http://localhost:8080)
   [INFO] Login URL: http://localhost:8080/auth/google/login
   ```

---

## 5. How to Test Login

1. Open your web browser and navigate to:
   ```
   http://localhost:8080/auth/google/login
   ```
2. You will be redirected to Google's sign-in and consent screen.
3. Select your Google account and grant permissions.
4. Google redirects back to:
   ```
   http://localhost:8080/auth/google/callback?code=...&state=...
   ```
5. The service validates the state, exchanges the code with the PKCE verifier, verifies the signed ID token, checks the nonce, and responds with:
   ```json
   {
     "success": true,
     "user": {
       "google_subject_id": "112345678901234567890",
       "email": "candidate@example.com",
       "email_verified": true,
       "name": "Jane Doe",
       "picture": "https://lh3.googleusercontent.com/a/...",
       "given_name": "Jane",
       "family_name": "Doe"
     }
   }
   ```

---

## 6. Common Errors & Troubleshooting

| Error | Root Cause | Solution |
| :--- | :--- | :--- |
| `redirect_uri_mismatch` | Google Console does not have `http://localhost:8080/auth/google/callback` in Authorized Redirect URIs. | Add the exact callback URL (including port and path) to the OAuth Client in Google Cloud Console. |
| `invalid_request: Missing authorization code or state parameter` | Callback accessed directly without completing the login initiation. | Start the login sequence from `/auth/google/login`. |
| `state validation failed: oauth transaction has expired` | More than 10 minutes elapsed between clicking login and completing Google sign-in. | Re-initiate login from `/auth/google/login`. |
| `potential replay detected / transaction not found` | The same callback URL was reloaded or reused. | Initiate a fresh login flow. Transactions are single-use by design. |
| `oidc nonce validation failed` | Tampered token or mismatch in state session. | Ensure single browser session is maintained between login start and callback. |
| `Failed to discover OIDC provider` | No internet connection or firewall blocking outbound HTTPS to `accounts.google.com`. | Check network connectivity to Google's discovery endpoint (`https://accounts.google.com/.well-known/openid-configuration`). |
