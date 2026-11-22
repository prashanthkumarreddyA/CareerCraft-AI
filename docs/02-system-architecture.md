# 02 · System architecture

This document explains how the pieces fit together. Feature rules are in
[03-phase-wise-features.md](03-phase-wise-features.md); endpoint details in
[05-backend-api-reference.md](05-backend-api-reference.md).

## 1. Overall system

```mermaid
flowchart LR
    subgraph Browser
        UI["React pages"] --> SVC["services/*.service.js"]
        SVC --> AX["axios instance (services/api.js)"]
    end
    AX -- "HTTPS, Authorization: Bearer JWT" --> MW
    subgraph Express["Express app (backend/app.js)"]
        MW["helmet → cors → morgan → json(1mb)"] --> HEALTH["/api/health"]
        MW --> LIM["apiLimiter"] --> ROUTES["/api/auth · /resumes · /job-analysis · /tailored-resumes · /applications"]
        ROUTES --> CTRL["controllers"] --> SRV["services"]
        SRV --> MODELS["Mongoose models"]
        SRV --> STORE["storage provider (Cloudinary)"]
        SRV --> AIP["AI provider (Gemini)"]
        SRV --> PDF["PDF extractor + Phase 1 engine"]
        ROUTES -.-> ERR["notFound + errorHandler"]
    end
    MODELS --> DB[("MongoDB")]
    STORE --> CLD[("Cloudinary")]
    AIP --> GEM["Gemini API"]
```

## 2. Backend architecture

### Layers

| Layer | Folder | Responsibility | Rule of thumb |
|---|---|---|---|
| Entry | `server.js` | checks env (`checkEnvironment`), starts HTTP server, connects MongoDB, graceful shutdown on SIGTERM/SIGINT | no business logic |
| App factory | `app.js` | `createApp({ storage, ai })` wires middleware and routes; dependencies are injectable (tests pass fakes) | no I/O at import time |
| Routes | `routes/*.routes.js` | URL → middleware chain → controller | `requireAuth`, `validateBody(schema)`, limiters |
| Controllers | `controllers/*.js` | read `req`, call a service, shape `{ success, data }` | thin |
| Services | `services/**` | business rules, ownership scoping, DB writes, AI and storage calls | every query filters by `userId` |
| Models | `models/*.js` | Mongoose schemas and indexes | — |
| Validators | `validators/*.js` | zod schemas for bodies/queries | strict objects (unknown keys rejected) |
| Utilities | `utils/ApiError.js`, `utils/logger.js` | typed client-safe errors, leveled logger | messages never contain secrets or resume text |

### Middleware order (`backend/app.js`)

1. `app.disable('x-powered-by')`, `trust proxy` = `TRUST_PROXY` (1 on Render) so rate limits see the client IP.
2. `helmet()` – security headers.
3. `cors(corsOptions)` – only origins from `CLIENT_URL` (see [08](08-security-and-privacy.md)).
4. `requestLogger` (morgan) – method, path without query string, status, size, duration.
5. `express.json({ limit: '1mb' })`.
6. `/api/health` – **outside** the rate limiter (the frontend polls it while Render wakes up).
7. `/api` → `apiLimiter` → `routes/index.js`, which adds `requireDatabase` (503 if MongoDB is not connected) per router.
8. `notFound` → `errorHandler`.

### Error handling

All errors become one envelope: `{ "success": false, "error": { "code", "message", "details"? } }`.

- `ApiError` (status + code + safe message) is thrown by services.
- `errorHandler` maps body-parser errors (`INVALID_JSON`, `PAYLOAD_TOO_LARGE`), multer errors
  (`FILE_TOO_LARGE`, …), Mongoose `CastError`/`ValidationError` (field names only, never values),
  duplicate keys (409 `DUPLICATE`) and MongoDB connectivity errors (503 `DATABASE_UNAVAILABLE`).
- Anything else is a 500 `INTERNAL_ERROR` with a generic message; only 5xx are logged, without stack
  traces in production.
- Express 5 forwards rejected promises from async handlers to `errorHandler`, so controllers do not
  need `try/catch`.

### Logging

`utils/logger.js` writes JSON lines in production (searchable in Render) and readable text in
development; nothing in tests. Request logs strip query strings and never include bodies. AI logs
contain task name, model, attempt count, latency and error kind – never prompts or answers.

### Environment configuration

`config/env.js` loads `backend/.env` locally (Node's built-in `process.loadEnvFile`; Render injects
variables instead), parses typed values into a frozen `config` object, and `checkEnvironment()`:

- **refuses to start in production** without `CLIENT_URL`, `MONGODB_URI`, `JWT_SECRET`,
  `GEMINI_API_KEY`, `GEMINI_MODEL`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`,
  `CLOUDINARY_API_SECRET`;
- warns about missing optional variables, short `JWT_SECRET`, localhost origins in production, and
  `CLIENT_URL` entries that had to be reduced to their origin.

Full variable list: [10-deployment-guide.md](10-deployment-guide.md#environment-variables).

### MongoDB connection

`config/db.js` connects in the background with exponential back-off (1 s → 30 s), so the HTTP server
and its health endpoint stay up while Atlas is unreachable. `requireDatabase` fails fast with 503
instead of letting Mongoose buffer queries. `strictQuery` is enabled.

### Dependency injection for external services

`createApp({ storage, ai })` takes two providers:

- **storage** – `cloudinaryStorage` (`services/cloudinary.service.js`) with `uploadPdf`, `deleteFile`,
  `getSignedUrl`, `fetchFile`. Tests use an in-memory fake (`tests/helpers/fakeStorage.js`).
- **ai** – `getDefaultAiProvider()` (`services/ai/index.js`) returns the Gemini provider when
  `GEMINI_API_KEY` and `GEMINI_MODEL` are set, otherwise an "unconfigured" provider that answers
  503 `AI_NOT_CONFIGURED`. Tests use `tests/helpers/fakeAi.js`.

## 3. Frontend architecture (summary)

React SPA with React Router data routers, two context providers (backend health, authentication),
page-level state with hooks, and one axios instance. Details: [07-frontend-architecture.md](07-frontend-architecture.md).

## 4. Frontend-to-backend request flow

```mermaid
sequenceDiagram
    participant P as Page component
    participant S as services/*.service.js
    participant A as axios (services/api.js)
    participant E as Express
    participant V as Service layer
    participant D as MongoDB
    P->>S: e.g. listApplications(filters)
    S->>A: GET /applications?tz=Asia/Kolkata&...
    A->>A: request interceptor adds Authorization: Bearer token
    A->>E: HTTPS request to VITE_API_URL + path
    E->>E: helmet, CORS, logger, JSON, rate limit, requireDatabase
    E->>E: requireAuth (verify JWT + tokenVersion)
    E->>V: controller calls service with req.user.id
    V->>D: query scoped by userId
    D-->>V: documents
    V-->>E: plain object
    E-->>A: 200 { success: true, data }
    A-->>S: response
    S-->>P: data (or ApiRequestError with status/code/message)
```

On errors the response interceptor converts everything into an `ApiRequestError`
(`status`, `code`, `message`, `details`, `isNetworkError`, `isTimeout`). A 401 on an authenticated
request ends the local session.

## 5. Authentication flow

```mermaid
sequenceDiagram
    participant B as Browser (AuthContext)
    participant API as /api/auth
    participant U as User collection
    B->>API: POST /auth/login { email, password }
    API->>U: findOne(email) incl. passwordHash, tokenVersion
    API->>API: bcrypt.compare (dummy hash if user unknown)
    API-->>B: { user, token (HS256, sub + tv), expiresAt }
    B->>B: localStorage["arb.session"] = { token, expiresAt, user }
    Note over B: every request: Authorization: Bearer token
    B->>API: GET /auth/me (on app load, to verify a stored session)
    API->>U: findById(sub) and compare tokenVersion
    API-->>B: { user } or 401 SESSION_REVOKED / TOKEN_EXPIRED
    B->>API: POST /auth/logout
    API->>U: $inc tokenVersion (all existing tokens become invalid)
    B->>B: remove localStorage session
```

## 6. Resume upload and extraction flow

```mermaid
sequenceDiagram
    participant B as Browser
    participant M as multer (memory, 5 MB, 1 file)
    participant S as master-resume.service
    participant X as pdf-extraction.service (pdf.js)
    participant T as template-check.service
    participant C as Cloudinary
    participant D as MongoDB
    B->>M: POST /resumes/upload (multipart field "resume")
    M->>S: file buffer
    S->>S: %PDF magic bytes within first 1024 bytes?
    S->>X: extractResumeFromPdf(buffer)
    X-->>S: lines + runs + fonts + structuredResumeData
    S->>S: zod structuredResumeSchema (strict)
    S->>T: checkTemplateCompatibility
    S->>C: upload raw/authenticated, random UUID name
    S->>D: MasterResume.create (unique per user)
    alt DB write fails
        S->>C: delete uploaded file (compensation)
    end
    S-->>B: 201 masterResume (no storage id)
```

Replacement (`PUT /resumes/master`) uploads the new file first, then atomically swaps the record
(conditional on the previous file id, so two concurrent replaces cannot both win) and moves the old
file into `backups` instead of deleting it.

## 7. AI job description analysis flow

```mermaid
flowchart TD
    A["POST /job-analysis {companyName, jobTitle, jobDescription}"] --> B["zod: lengths, ≥ 12 words, cleaned text"]
    B --> C["Load master resume (must exist)"]
    C --> D["buildResumeEvidence: numbered lines, no contact details, redacted"]
    D --> E["Gemini: one structured-JSON call (analysis-prompt.js)"]
    E --> F["zod validation of the answer"]
    F --> G["consolidateRequirements: keyword must appear in JD, resolve to taxonomy, merge duplicates"]
    G --> H["matchRequirement: rules decide DIRECT / SUPPORTED / RELATED / MISSING"]
    H --> I["matchResponsibilities + matchExperience"]
    I --> J["calculateMatchScore (JavaScript)"]
    J --> K["JobAnalysis.create (snapshot + source resume hash)"]
```

## 8. Resume tailoring and PDF generation flow

```mermaid
flowchart TD
    A["POST /job-analysis/:id/tailored-resumes"] --> B{"analysis made from current master?"}
    B -- no --> X["409 ANALYSIS_STALE"]
    B -- yes --> C["buildFactSheet: evidence + supported keywords + gaps"]
    C --> D["Gemini: summary + bullet rewrites (structured JSON)"]
    D --> E["checkClaim per proposal"]
    E -- errors --> F["one repair round with the issues"]
    F --> E2["still failing → blocked (shown, never offered)"]
    E -- passed --> G["changes (pending)"]
    C --> H["rules: skills order + bullet order"] --> G
    G --> I["user: accept / reject / edit (+ confirmations)"]
    I --> J["approve: validateDocument → freeze finalContent + SHA-256 hash"]
    J --> K["POST /pdf: re-validate, render with Phase 1 engine"]
    K --> L["read PDF back, compare with approved content and master template"]
    L -- pass --> M["upload private to Cloudinary, status pdf_ready"]
    L -- fail --> N["422 PDF_VALIDATION_FAILED (nothing stored)"]
```

## 9. Job application tracking flow

```mermaid
flowchart TD
    A["Track this job / New application"] --> B["POST /applications (optional jobAnalysisId, tailoredResumeId)"]
    B --> C["resolveLinks: owned? version approved? same analysis?"]
    C --> D["JobApplication document (status: saved | applied)"]
    D --> E["POST /:id/status → transition table check → statusHistory += change"]
    E --> F["POST /:id/status/undo → statusHistory += undo"]
    D --> G["interviews: add / edit / reschedule / cancel"]
    D --> H["follow-ups: add / complete / delete"]
    D --> I["PUT /:id/links → linkHistory += previous link"]
    D --> J["GET /dashboard, /board, /export.csv, list with filters"]
```

All application changes are single-document atomic updates guarded by a `revision` number
(optimistic concurrency), so no multi-document transactions are needed. This matters because the
local development MongoDB is a standalone server, where transactions are not available.

## 10. PDF generation architecture

```mermaid
flowchart LR
    J["structured resume JSON"] --> BP["buildParagraphs (template order + styles)"]
    BP --> L["layoutResume (Word-like line breaking, keep-with-next, widow/orphan control)"]
    F["Carlito Latin TTFs"] --> L
    L --> R["renderResumePdf (pdf-lib, fonts embedded, no subsetting)"]
    R --> P["PDF bytes"]
    P --> X["pdf.js re-extraction for validation"]
```

- The engine lives in `research/phase1/resume-template.mjs`; `backend/pdf/resume-template.mjs` is a
  **byte-identical copy** (a test compares the two files).
- `backend/services/tailoring/resume-renderer.js` only feeds data into the engine and reads its layout
  output (`layoutCheck` for page count, overflow and per-paragraph line counts).

## 11. Cloudinary integration

- Assets are uploaded with `resource_type: raw` and `type: authenticated`: no public delivery URL exists.
- Public ids are random UUIDs under `resumes/master/<userId>/` and `resumes/customized/<userId>/`;
  file names (which may contain a person's name) never appear in storage paths.
- Access is either streamed by the backend after an ownership check (`/file`, `/pdf`, with SHA-256
  integrity verification), or via a **signed URL** valid for `SIGNED_URL_TTL_SECONDS` (default 300 s).
- Storage ids are never returned to the browser.
