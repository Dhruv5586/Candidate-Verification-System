# Node.js + TypeScript Backend Architecture

This document describes the architectural foundation, design principles, error handling models, and deployment configurations for the **Candidate Verification System Node.js API Service**.

---

## 1. System Responsibilities

The Node.js backend operates as the primary business logic and domain processing engine within the dual-service monorepo:

- **Business Domain Processing:** Candidate management, background claims tracking, and document verification workflows (Phases 6–9).
- **Batch Processing Engine:** Candidate CSV import ingestion, parsing, sanitization, and deduplication.
- **Relational Data Access:** Direct PostgreSQL access using connection pooling via `pg.Pool`.
- **Identity & Authorization Consumer:** Delegates authentication and session token verification to the Go Auth Service via the protected internal bridge (`POST /internal/session/validate`).

```
[Browser / Client]
         |
         | (1) Cookie-Authenticated Business Requests
         v
[Node.js Express API] (:3000)
         |
         +---> (2) Validate Session (POST /internal/session/validate) ---> [Go Auth Service] (:8080)
         |                                                                      |
         | (3) Query / Mutate Candidates, Claims, Verifications                  | (Validates Hash)
         v                                                                      v
[PostgreSQL 18 Database] (candidate_verification) <----------------------------+
```

---

## 2. Clean Architecture Folder Structure

```plaintext
node-api/
├── src/
│   ├── config/
│   │   ├── env.ts              # Zod runtime environment validation
│   │   └── database.ts         # pg.Pool connection pooling & lifecycle
│   ├── controllers/            # HTTP request/response orchestrators
│   │   └── health.controller.ts
│   ├── services/               # Business logic & domain algorithms
│   │   └── health.service.ts
│   ├── repositories/           # Database access & SQL abstraction
│   │   └── base.repository.ts  # Generic parameterized query base class
│   ├── routes/                 # Express routing & versioning
│   │   ├── index.ts            # Base router (/api/v1)
│   │   ├── health.routes.ts    # Health routes
│   │   └── docs.routes.ts      # Swagger UI / OpenAPI docs
│   ├── middleware/             # Cross-cutting concerns
│   │   ├── requestLogger.ts    # Pino HTTP request logging
│   │   ├── errorHandler.ts     # Centralized error mapping
│   │   └── notFoundHandler.ts  # Standard 404 handler
│   ├── validators/             # Zod schema validation helpers
│   │   └── common.validator.ts
│   ├── types/                  # Shared TypeScript interfaces & types
│   │   └── api.types.ts
│   ├── utils/                  # Reusable utilities
│   │   ├── logger.ts           # Pino logger singleton
│   │   └── errors.ts           # Operational AppError hierarchy
│   ├── docs/                   # API documentation
│   │   └── swagger.ts          # OpenAPI 3.0 specification definition
│   ├── app.ts                  # Express application composition
│   ├── server.ts               # HTTP listener & graceful shutdown
│   └── tests/                  # Automated integration & unit tests
│       ├── app.test.ts
│       └── env.test.ts
├── package.json
├── tsconfig.json
└── .env.example
```

---

## 3. API Versioning Strategy

All business routes are explicitly prefixed with `/api/v1` to guarantee backward compatibility:
- Versioning is declared at the router mount point in `src/app.ts`:
  ```typescript
  app.use('/api/v1', apiRouter);
  ```
- Sub-routers mount cleanly without hardcoded version strings (`healthRoutes`, `candidateRoutes`, `docsRoutes`).

---

## 4. Centralized Error Handling

All thrown exceptions and rejected promises pass through `errorHandler.ts`:

1. **`ZodError` (400 Bad Request):** Formats validation field mismatches into structured `{ field, message }` arrays.
2. **`AppError` (Operational Errors):** Maps custom domain errors (`NotFoundError`, `BadRequestError`, `UnauthorizedError`, `ForbiddenError`, `ConflictError`) with corresponding HTTP status codes.
3. **Unhandled 500 Errors:** Logs detailed error contexts via Pino while stripping stack traces in production environments to prevent information disclosure.

**Standard Error Response Schema:**
```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Resource not found",
    "details": {}
  }
}
```

---

## 5. PostgreSQL Connection Management

- Implemented in `src/config/database.ts` using `pg.Pool`.
- Connection parameters:
  - `max: 20` simultaneous connections.
  - `idleTimeoutMillis: 30000` (30 seconds).
  - `connectionTimeoutMillis: 5000` (5 seconds).
- Reuses the existing `candidate_verification` database.
- Database pool automatically drains and terminates gracefully on `SIGINT` and `SIGTERM`.

---

## 6. How to Run the Service

### Prerequisites
- Node.js 20+ installed.
- PostgreSQL running locally with database `candidate_verification`.
- Go Auth Service running on `http://localhost:8080`.

### Development Mode (with Live Reloading)
```powershell
cd D:\CandidateVerificationSystem\node-api
npm run dev
```

### Type Checking & Automated Tests
```powershell
npm run typecheck
npm test
```

### Production Build & Execution
```powershell
npm run build
npm start
```

### API Endpoints
- **Service Health:** `GET http://localhost:3000/api/v1/health`
- **Database Health:** `GET http://localhost:3000/api/v1/health/database`
- **Interactive Swagger Docs:** `GET http://localhost:3000/api/v1/docs`
- **OpenAPI JSON Spec:** `GET http://localhost:3000/api/v1/docs/json`
