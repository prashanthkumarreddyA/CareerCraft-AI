# 05 · Backend API reference

Base URL: `<API>/api`, where `<API>` is `http://localhost:5000` locally or
`https://careercraft-ai-pmk4.onrender.com` in production.

## Conventions

- **Success:** `{ "success": true, "data": { … } }`
- **Error:** `{ "success": false, "error": { "code": "…", "message": "…", "details": … } }`
  (`details` is optional; validation details list `path` + `message`, never submitted values).
- **Auth:** `Authorization: Bearer <JWT>` on every route marked 🔒. Missing/invalid token → 401
  (`AUTH_REQUIRED`, `INVALID_TOKEN`, `TOKEN_EXPIRED`, `SESSION_REVOKED`).
- **Ownership:** an id that does not exist, belongs to another user or is malformed → 404.
- **Concurrency:** mutating tailored-resume and application endpoints require `expectedRevision`;
  a stale value → 409 `REVISION_CONFLICT`.
- **Common errors on every route:** 429 `RATE_LIMITED`, 503 `DATABASE_UNAVAILABLE`,
  400 `INVALID_JSON`, 413 `PAYLOAD_TOO_LARGE` (JSON > 1 MB), 403 `CORS_ORIGIN_DENIED` (browser from a
  non-allowed origin), 404 for unknown routes, 500 `INTERNAL_ERROR`.
- **Validation:** request bodies use strict zod schemas: unknown keys → 400 `VALIDATION_ERROR`.

| Limiter | Applies to | Limit |
|---|---|---|
| `apiLimiter` | all `/api/*` except health | `RATE_LIMIT_MAX` (300) per `RATE_LIMIT_WINDOW_MS` (15 min) per IP |
| `authLimiter` | register, login | 20 per 15 min per IP |
| `uploadLimiter` | master upload/replace, tailored PDF generation | 20 per hour per user |
| `aiLimiter` | create analysis, create tailored version | 30 per hour per user |

---

## Health

### `GET /api/health`
No auth, not rate-limited. Controller `health.controller.js`.

```json
{ "success": true, "data": { "status": "ok", "service": "ai-resume-builder-api", "version": "0.1.0",
  "environment": "production", "uptimeSeconds": 42, "timestamp": "2026-11-22T10:00:00.000Z",
  "dependencies": { "database": "connected", "ai": "configured" } } }
```
`status` is `degraded` when the database is not connected. Always HTTP 200 while the process runs.

---

## Authentication (`routes/auth.routes.js` → `auth.controller.js` → `auth.service.js` → `User`)

### `POST /api/auth/register`
Body: `{ "name": "Alex Morgan", "email": "alex@example.com", "password": "at-least-8-chars" }`
(name 1–100; email ≤ 254, lower-cased; password 8–128).

201:
```json
{ "success": true, "data": { "user": { "id": "665f…", "name": "Alex Morgan", "email": "alex@example.com", "createdAt": "…" },
  "token": "<JWT>", "expiresAt": "2026-11-29T10:00:00.000Z" } }
```
Errors: 400 `VALIDATION_ERROR`, 409 `EMAIL_IN_USE`, 429.

### `POST /api/auth/login`
Body: `{ "email", "password" }`. 200 with the same shape as register. Errors: 400, 401
`INVALID_CREDENTIALS`, 429.

### `POST /api/auth/logout` 🔒
Revokes all tokens of the user. 200 `{ "loggedOut": true }`.

### `GET /api/auth/me` 🔒
200 `{ "user": { "id", "name", "email" } }`.

---

## Master resume (`routes/resume.routes.js` → `masterResume.controller.js` → `master-resume.service.js` → `MasterResume`)

### `POST /api/resumes/upload` 🔒 (upload limiter)
`multipart/form-data`, one file in field **`resume`**, PDF, ≤ `MAX_UPLOAD_SIZE_MB` (5 MB).

201 `{ "masterResume": MasterResume }` where `MasterResume` is:
```json
{ "id": "…", "originalFileName": "resume.pdf", "fileFormat": "pdf", "fileSize": 85123,
  "fileHash": "<sha256>", "pageCount": 2, "templateId": "classic-v1",
  "templateCompatibility": { "compatible": true, "issues": [] }, "extractorVersion": "phase1-v1",
  "uploadedAt": "…", "updatedAt": "…", "structuredResumeData": { "…": "see 03" },
  "extractedContent": { "pageCount": 2, "pageSize": { "width": 612, "height": 792 }, "fonts": ["…"], "fontSizes": [10.5, 12, 18],
    "lineCount": 81, "text": "…full extracted text…", "unknownSections": [] },
  "backups": [] }
```
Errors: 400 `FILE_REQUIRED`, `UNEXPECTED_FILE_FIELD`, `TOO_MANY_FILES`; 413 `FILE_TOO_LARGE`;
415 `UNSUPPORTED_FILE_TYPE`; 422 `INVALID_PDF`, `PDF_ENCRYPTED`, `NO_TEXT`, `UNSUPPORTED_LAYOUT`,
`EXTRACTION_INVALID`; 409 `MASTER_RESUME_EXISTS`; 502 `STORAGE_ERROR`; 503 `STORAGE_NOT_CONFIGURED`.

### `GET /api/resumes/master` 🔒
Query `include=lines` adds `extractedContent.lines` (every line with runs and coordinates).
200 `{ "masterResume": MasterResume }`; 404 `MASTER_RESUME_NOT_FOUND`.

### `PUT /api/resumes/master` 🔒 (upload limiter)
Same multipart format as upload. Replaces file and content; previous PDF appended to `backups`.
Errors as upload, plus 404 `MASTER_RESUME_NOT_FOUND`, 409 `CONCURRENT_UPDATE`.

### `DELETE /api/resumes/master` 🔒
Deletes backups, file and record. 200 `{ "deleted": true }`.

### `GET /api/resumes/master/file` 🔒
Streams the PDF (`application/pdf`, `inline`, `Cache-Control: private, no-store`) after a SHA-256
check. Errors: 404 `MASTER_RESUME_NOT_FOUND`, `FILE_MISSING`; 502 `FILE_INTEGRITY_ERROR`, `STORAGE_ERROR`.

### `GET /api/resumes/master/download-url` 🔒
200 `{ "url": "<signed Cloudinary URL>", "expiresAt": "…" }` (valid `SIGNED_URL_TTL_SECONDS`).

### `GET /api/resumes/master/backups/:backupId/file` 🔒 · `GET …/download-url` 🔒
Same as the two endpoints above, for a previous PDF. 404 `BACKUP_NOT_FOUND`.

---

## Job description analysis (`routes/job-analysis.routes.js` → `jobAnalysis.controller.js` → `job-analysis.service.js` + `services/job-analysis/*` → `JobAnalysis`)

### `POST /api/job-analysis` 🔒 (AI limiter)
Body:
```json
{ "companyName": "Northwind Labs", "jobTitle": "Senior Backend Engineer",
  "jobDescription": "We are looking for … (80–20,000 characters, at least 12 words)" }
```
201 `{ "jobAnalysis": JobAnalysis }`:
```json
{ "id": "…", "companyName": "Northwind Labs", "jobTitle": "Senior Backend Engineer", "jobDescription": "…",
  "jobAnalysis": { "roleSummary": "…", "seniority": "senior", "requiredExperience": { "minYears": 5, "maxYears": null, "quote": "5+ years …", "verified": true },
    "education": null, "categories": { "backend": ["Node.js"] }, "mustHave": ["Node.js"], "preferred": ["GraphQL"], "optional": [],
    "responsibilities": ["…"], "softSkills": ["…"] },
  "keywordAnalysis": { "mustHave": [{ "keyword": "Node.js", "normalizedName": "Node.js", "category": "backend", "classification": "DIRECT_MATCH" }],
    "preferred": [], "optional": [], "totals": { "unique": 9, "mustHave": 6, "preferred": 3, "optional": 0, "duplicatesMerged": 1, "unverifiedDropped": 0 } },
  "matchAnalysis": { "requirements": [{ "id": "nodejs", "keyword": "Node.js", "classification": "DIRECT_MATCH", "importance": "must_have",
      "evidence": [{ "id": "skills.2.1", "source": "Technical skills › Backend", "text": "Node.js" }], "relatedSkills": [], "aiClassification": "DIRECT_MATCH",
      "adjustments": [], "decidedBy": "rules", "explanation": "…" }],
    "responsibilities": [], "experience": { "…": "…" }, "score": { "matchPercentage": 74, "breakdown": [], "formula": "…", "disclaimer": "…" }, "warnings": [] },
  "matchPercentage": 74, "analysisVersion": "phase4-v1", "sourceResume": { "fileHash": "<sha256>" }, "stale": false,
  "ai": { "provider": "gemini", "model": "<GEMINI_MODEL>" }, "createdAt": "…", "updatedAt": "…" }
```
Errors: 400 `VALIDATION_ERROR`; 422 `MASTER_RESUME_REQUIRED`; 503 `AI_NOT_CONFIGURED`; AI errors
(see [06](06-ai-architecture.md#errors)).

### `GET /api/job-analysis` 🔒
Query `page` (default 1), `limit` (default 20, max 50; invalid values fall back to defaults).
200 `{ "items": [Summary], "page", "limit", "total", "totalPages" }` where `Summary` has `id`,
`companyName`, `jobTitle`, `matchPercentage`, `totalRequirements`, `matchedRequirements`,
`partiallySupportedRequirements`, `missingRequirements`, `mustHaveCoverage`, `analysisVersion`,
`stale`, `createdAt`. Newest first.

### `GET /api/job-analysis/:id` 🔒
200 `{ "jobAnalysis": JobAnalysis }`; 404 `JOB_ANALYSIS_NOT_FOUND`.

### `DELETE /api/job-analysis/:id` 🔒
200 `{ "deleted": true }`; 409 `JOB_ANALYSIS_HAS_VERSIONS`, 409 `LINKED_TO_APPLICATION`.

---

## Resume tailoring (`routes/tailored-resume.routes.js` + `/job-analysis/:id/tailored-resumes` → `tailoredResume.controller.js` → `tailored-resume.service.js`, `tailored-pdf.service.js`, `services/tailoring/*` → `TailoredResume`)

### `POST /api/job-analysis/:id/tailored-resumes` 🔒 (AI limiter)
No body. 201 `{ "tailoredResume": TailoredResume }`:
```json
{ "id": "…", "jobAnalysisId": "…", "versionNumber": 1, "status": "draft", "revision": 0,
  "companyName": "…", "jobTitle": "…",
  "changes": [{ "changeId": "bullet-1-1", "type": "bullet", "target": { "type": "bullet", "roleIndex": 0, "bulletIndex": 0 },
      "original": "…", "proposed": "…", "explanation": "…", "evidence": [], "targetedKeywords": ["RESTful APIs"],
      "validation": { "passed": true, "needsReview": false, "issues": [] }, "decision": "pending", "history": [{ "action": "proposed", "by": "ai" }] }],
  "blocked": [], "gaps": [{ "keyword": "Kubernetes", "importance": "preferred", "classification": "MISSING", "relatedSkills": [] }],
  "progress": { "total": 5, "pending": 5, "accepted": 0, "rejected": 0, "edited": 0, "overrides": 0, "reviewed": 0 },
  "baseContent": {}, "content": {}, "contentHash": null,
  "coverage": { "literalBefore": 8, "literalAfter": 9, "supportedKeywords": 9, "gapsUnchanged": ["Kubernetes"] },
  "layout": { "pageCount": 2, "maxPages": 2, "passed": true, "grownParagraphs": [], "errors": [] },
  "validationReport": null, "pdf": null, "copiedFrom": null, "masterChanged": false,
  "ai": { "provider": "gemini", "model": "…", "repairRound": false }, "approvedAt": null, "createdAt": "…", "updatedAt": "…" }
```
Change types: `summary`, `bullet`, `skills_order`, `bullet_order`.
Errors: 404 `JOB_ANALYSIS_NOT_FOUND`; 409 `ANALYSIS_STALE`; 422 `MASTER_RESUME_REQUIRED`; 503
`AI_NOT_CONFIGURED`; AI errors.

### `GET /api/job-analysis/:id/tailored-resumes` 🔒 · `GET /api/tailored-resumes` 🔒
200 `{ "items": [{ "id", "jobAnalysisId", "versionNumber", "status", "companyName", "jobTitle",
"progress", "hasPdf", "masterChanged", "approvedAt", "createdAt" }] }` (newest first, max 200).

### `GET /api/tailored-resumes/:id` 🔒
200 `{ "tailoredResume": TailoredResume }`. For drafts, proposal validations are re-computed with the
current rules. 404 `TAILORED_RESUME_NOT_FOUND`.

### `PATCH /api/tailored-resumes/:id/changes/:changeId` 🔒
Body (one of):
```json
{ "decision": "accept", "expectedRevision": 3, "confirmReview": true }
{ "decision": "reject", "expectedRevision": 3 }
{ "decision": "reset",  "expectedRevision": 3 }
{ "decision": "edit", "text": "…", "confirmOverride": true, "confirmReview": true, "expectedRevision": 3 }
```
200 `{ "tailoredResume" }`. Errors: 404 `CHANGE_NOT_FOUND`; 409 `VERSION_LOCKED`, `REVISION_CONFLICT`;
422 `PROPOSAL_INVALID`, `REVIEW_REQUIRED`, `CLAIM_CHECK_FAILED` (overridable issues listed),
`EDIT_INVALID` (non-overridable issues); 400 `EDIT_NOT_ALLOWED` (editing an order change).

### `POST /api/tailored-resumes/:id/accept-all` 🔒
Body `{ "expectedRevision" }`. Accepts pending proposals that passed and need no review.

### `POST /api/tailored-resumes/:id/approve` 🔒
Body `{ "expectedRevision" }`. Freezes `finalContent` + `contentHash`. Errors: 422 `APPROVAL_BLOCKED`
(`details.problems` with codes such as `DECISIONS_PENDING`, `UNSUPPORTED_CLAIM`,
`REVIEW_NOT_CONFIRMED`, `LOCKED_FIELD_CHANGED`, `ORDER_INVALID`, `UNSUPPORTED_CHARACTER`,
`LAYOUT_INVALID`); 409 `MASTER_CHANGED`, `VERSION_LOCKED`.

### `POST /api/tailored-resumes/:id/duplicate` 🔒
201 `{ "tailoredResume" }` – new draft with the same decisions. 409 `MASTER_CHANGED`.

### `DELETE /api/tailored-resumes/:id` 🔒
Deletes the PDF file then the record. 200 `{ "deleted": true }`; 409 `LINKED_TO_APPLICATION`.

### `POST /api/tailored-resumes/:id/pdf` 🔒 (upload limiter)
201 `{ "tailoredResume" }` with `status: "pdf_ready"` and `pdf: { fileHash, fileSize, pageCount,
templateId, generatedAt, validation }`. Errors: 409 `NOT_APPROVED`, `PDF_EXISTS`, `MASTER_CHANGED`,
`REVISION_CONFLICT`; 422 `PDF_VALIDATION_FAILED` (`details.problems`: `CONTENT_HASH_MISMATCH`,
`CONTENT_NOT_FROM_DECISIONS`, `TOO_MANY_PAGES`, `PDF_UNREADABLE`, `CONTENT_MISMATCH`,
`TEMPLATE_MISMATCH`, `PAGE_COUNT_MISMATCH`, `STYLE_MISMATCH`, `MARGIN_MISMATCH`, `HEADINGS_MISMATCH`, …);
502 `STORAGE_ERROR`.

### `GET /api/tailored-resumes/:id/pdf` 🔒 · `GET /api/tailored-resumes/:id/pdf/download-url` 🔒
Stream (integrity-checked, file name `resume-<company>-v<n>.pdf`) or signed URL
`{ "url", "expiresAt" }`. 404 `PDF_NOT_FOUND`; 502 `FILE_INTEGRITY_ERROR`.

---

## Job applications (`routes/job-application.routes.js` → `jobApplication.controller.js` → `job-application.service.js`, `job-application-links.service.js` → `JobApplication`)

Most application endpoints accept `?tz=<IANA zone>` (e.g. `Asia/Kolkata`); invalid zones fall back to
UTC. It controls "today" (auto-filled application dates, overdue follow-ups).

### `POST /api/applications` 🔒
```json
{ "companyName": "Contoso", "jobTitle": "Full Stack Developer", "location": "Remote",
  "employmentType": "full_time", "salary": { "min": 1800000, "max": 2400000, "currency": "INR", "period": "year" },
  "experience": { "minYears": 3, "maxYears": 6, "text": "3–6 years" }, "source": "linkedin", "sourceDetail": "Job post",
  "jobUrl": "https://jobs.example.com/123", "jobDescription": "…", "applicationDate": "2026-11-10", "notes": "…",
  "status": "saved", "jobAnalysisId": "…", "tailoredResumeId": "…" }
```
Everything is optional except company and title, which may come from the linked analysis (the
analysis's job description is copied when none is given). `status` may only be `saved` or `applied`.

201 `{ "application": Application }`:
```json
{ "id": "…", "companyName": "Contoso", "jobTitle": "Full Stack Developer", "location": "Remote", "employmentType": "full_time",
  "salary": { "min": 1800000, "max": 2400000, "currency": "INR", "period": "year" }, "experience": { "minYears": 3, "maxYears": 6, "text": "3–6 years" },
  "source": "linkedin", "sourceDetail": "Job post", "jobUrl": "https://jobs.example.com/123", "jobDescription": "…",
  "applicationDate": "2026-11-10", "notes": "…", "status": "saved", "allowedStatuses": ["applied", "interview", "withdrawn"], "canUndo": false,
  "statusHistory": [{ "from": null, "to": "saved", "kind": "created", "note": "", "at": "…" }],
  "jobAnalysisId": "…", "tailoredResumeId": "…", "linkedAt": "…", "linkHistory": [],
  "links": { "jobAnalysis": { "id": "…", "companyName": "…", "jobTitle": "…", "matchPercentage": 74, "createdAt": "…", "stale": false },
    "tailoredResume": { "id": "…", "versionNumber": 1, "status": "pdf_ready", "approvedAt": "…", "hasPdf": true, "pdfPageCount": 2, "masterChanged": false } },
  "interviews": [], "followUps": [], "nextInterview": null, "revision": 0, "createdAt": "…", "updatedAt": "…" }
```
Errors: 400 `VALIDATION_ERROR`; 404 `JOB_ANALYSIS_NOT_FOUND`, `TAILORED_RESUME_NOT_FOUND`; 422
`VERSION_NOT_APPROVED`, `LINK_MISMATCH`.

### `GET /api/applications` 🔒
Query: `q`, `status` (comma list or repeated), `location`, `source`, `from`, `to` (YYYY-MM-DD),
`sort` (`applicationDate` | `updatedAt` | `createdAt` | `companyName` | `jobTitle`, default
`updatedAt`), `order` (`asc` | `desc`), `page`, `limit` (≤ 50). Invalid status/source/dates → 400.
200 `{ "items": [Summary], "page", "limit", "total", "totalPages" }`; summaries contain `id`,
company, title, location, employment type, source, status, `allowedStatuses`, `applicationDate`,
`hasResumeLink`, `jobAnalysisId`, `nextFollowUp`, `overdueFollowUps`, `nextInterview`, `revision`,
timestamps (no job description or notes).

### `GET /api/applications/:id` 🔒 · `PATCH /api/applications/:id` 🔒 · `DELETE /api/applications/:id` 🔒
- GET → `{ "application" }`; 404 `APPLICATION_NOT_FOUND`.
- PATCH body: any subset of the editable fields + `expectedRevision` (status and links cannot be
  changed here). 409 `REVISION_CONFLICT`.
- DELETE → `{ "deleted": true }`; deletes only the application.

### `POST /api/applications/:id/status` 🔒
`{ "status": "interview", "note": "Recruiter call booked", "expectedRevision": 2 }`.
422 `INVALID_STATUS_TRANSITION` (`details: { from, to, allowed }`), 422 `LIMIT_REACHED`, 409.

### `POST /api/applications/:id/status/undo` 🔒
`{ "expectedRevision" }`. 422 `NOTHING_TO_UNDO`.

### `PUT /api/applications/:id/links` 🔒
`{ "jobAnalysisId": "…" | null, "tailoredResumeId": "…" | null, "expectedRevision" }`. Same link
errors as create, plus 409 `LINK_TARGET_DELETED`, 422 `LIMIT_REACHED`.

---

## Interviews and follow-ups

| Method | Path | Body | Notes / errors |
|---|---|---|---|
| POST | `/api/applications/:id/interviews` 🔒 | `roundType` (required), `scheduledAt` (ISO with offset, required), `durationMinutes`, `interviewer`, `meetingLink`, `notes`, `feedback`, `result`, `expectedRevision` | 201; 422 `LIMIT_REACHED` (20) |
| PATCH | `/api/applications/:id/interviews/:interviewId` 🔒 | any interview field, `completed: true`, `expectedRevision` | 404 `INTERVIEW_NOT_FOUND`; 422 `INTERVIEW_CANCELLED` |
| POST | `…/interviews/:interviewId/reschedule` 🔒 | `scheduledAt`, `reason`, `expectedRevision` | 422 `INTERVIEW_NOT_SCHEDULED`, `SAME_TIME`, `LIMIT_REACHED` |
| POST | `…/interviews/:interviewId/cancel` 🔒 | `reason`, `expectedRevision` | 422 `INTERVIEW_NOT_SCHEDULED` |
| POST | `/api/applications/:id/follow-ups` 🔒 | `dueDate` (YYYY-MM-DD), `note`, `expectedRevision` | 201; 422 `LIMIT_REACHED` (50) |
| PATCH | `/api/applications/:id/follow-ups/:followUpId` 🔒 | `dueDate`, `note`, `status` (`pending`/`completed`), `expectedRevision` | 404 `FOLLOW_UP_NOT_FOUND` |
| DELETE | `/api/applications/:id/follow-ups/:followUpId` 🔒 | `{ "expectedRevision" }` (JSON body) | |

All return `{ "application" }` with the updated document. There is no endpoint to delete an interview.

---

## Dashboard and analytics

### `GET /api/applications/dashboard?tz=` 🔒
```json
{ "dashboard": { "generatedAt": "…", "timeZone": "Asia/Kolkata", "today": "2026-11-22",
  "totals": { "applications": 3, "byStatus": { "saved": 0, "applied": 1, "interview": 1, "selected": 0, "rejected": 0, "withdrawn": 1 },
    "interviewsScheduled": 0, "offers": 0, "reachedApplied": 2, "reachedInterview": 1, "reachedSelected": 0 },
  "rates": { "interviewConversion": 50, "selectionRate": 0, "offerRate": 0 },
  "trends": { "weekly": [{ "start": "2026-11-16", "count": 3 }], "monthly": [{ "month": "2026-11", "count": 3 }] },
  "recentApplications": [], "followUps": { "overdue": [], "upcoming": [], "pendingTotal": 1 }, "upcomingInterviews": [] } }
```
Rates are `null` when the denominator is 0. `weekly` and `monthly` always have 12 entries.

### `GET /api/applications/board?tz=` 🔒
`{ "columns": { "saved": [Summary], "applied": [], "interview": [], "selected": [], "rejected": [], "withdrawn": [] }, "total": 3, "truncated": false }`

---

## CSV export

### `GET /api/applications/export.csv` 🔒
Same query filters and sorting as the list (no pagination). Response headers:
`Content-Type: text/csv; charset=utf-8`,
`Content-Disposition: attachment; filename="job-applications-YYYY-MM-DD.csv"`,
`Cache-Control: private, no-store`. Columns: Company, Job title, Status, Application date, Location,
Employment type, Salary min/max/currency/period, Experience, Source, Source detail, Job URL,
Interview rounds, Next interview, Pending follow-ups, Next follow-up, Analysis match %, Resume
version, Notes, Created, Last updated. Errors: 400 invalid filters, 422 `EXPORT_TOO_LARGE`
(> 10,000 rows).
