# System Architecture: Candidate Verification System

## 1. Overview
The **Candidate Verification System** is an enterprise-grade platform for automating and managing background verification workflows for job candidates.

The architecture decouples authentication and identity management from business logic and data processing:
- **Go Authentication Service (`go-auth`)**: Handles Google OAuth 2.0 / OpenID Connect (OIDC), PKCE, and session token verification.
- **PostgreSQL 18 (`candidate_verification`)**: Centralized relational data store with 11 core tables, strong constraints, and immutable audit logs.
- **Node.js / Express API (`node-api`)**: Candidate lifecycle management, CSV import processing, document verification workflows, and business validation rules (Future Phase).

---

## 2. Architecture Diagram

```mermaid
graph TD
    Client[Browser / Frontend Client] -->|1. OAuth 2.0 Login / Callback| GoAuth[Go Auth Service]
    Client -->|4. Business Operations / Candidate Verification| NodeAPI[Node.js API Service]

    subgraph Authentication & Identity
        GoAuth -->|OIDC Discovery / Token Exchange| GoogleOIDC[Google OAuth 2.0 / OIDC]
        GoAuth -->|2. Upsert User / Read Roles| Postgres[(PostgreSQL 18 DB)]
        GoAuth -->|3. Issue Session Token| Client
    end

    subgraph Business Logic & Ingestion
        NodeAPI -->|Verify Session & Identity| GoAuth
        NodeAPI -->|Read / Write Candidates, Claims, Verifications| Postgres
        NodeAPI -->|Upload Evidence Metadata| S3Storage[Document Storage / S3]
    end
```

---

## 5. Node.js Express API Service
- **Runtime:** Node.js 26+ with TypeScript (ES2022)
- **Framework:** Express 4.x with Helmet, CORS, and Pino structured logging
- **Configuration:** Zod schema-enforced environment parsing
- **Database Driver:** `pg` (`Pool`) reusing shared `candidate_verification` database
- **Documentation:** Interactive OpenAPI 3.0 / Swagger UI at `/api/v1/docs`
