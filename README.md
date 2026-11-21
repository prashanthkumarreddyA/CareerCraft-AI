# AI Resume Builder: job-specific resume optimizer

Upload a master resume once, paste a job description, and generate a tailored resume that keeps the
original template's exact layout. Only relevant wording changes, and only where your real experience supports it.

> Status: **Phase 6 (job application tracker) complete.** Phases 7–8 follow.

## Repository layout

```
.
├── frontend/          React + Vite + Tailwind SPA        → deployed to Netlify (base dir: frontend)
├── backend/           Node.js + Express API              → deployed to Render  (root dir: backend)
├── research/phase1/   Phase 1 PDF analysis: extractor, measured template engine, validator
├── .githooks/         pre-commit guard against committing resumes or credentials
├── render.yaml        Render Blueprint (backend only)
└── README.md
```

Frontend and backend have **independent `package.json` files** and deploy independently.
There is no root `package.json`.

## Prerequisites

- Node.js **20.19+ or 22.12+** (Vite 8 requirement; tested with 22.18)
- npm 10+
- Optional: MongoDB (Atlas or local) once database features land in Phase 3
- Optional (research only): Python 3 + `pip install pymupdf` to run `research/phase1/validate.py`

## Local development

```bash
# one-time: enable the privacy pre-commit hook
git config core.hooksPath .githooks

# backend: http://localhost:5000
cd backend
cp .env.example .env        # fill in values as phases require them
npm install
npm run dev                 # node --watch

# frontend: http://localhost:5180 (separate terminal)
cd frontend
cp .env.example .env.local  # VITE_API_URL=http://localhost:5000/api
npm install
npm run dev
```

The frontend dev server uses port **5180** (`strictPort`), so it never silently collides with other
Vite apps on 5173. The backend's development CORS defaults allow `http://localhost:5180` and the
preview port `http://localhost:4180`.

| Command | Where | What it does |
|---|---|---|
| `npm run dev` | backend | start the API with auto-restart |
| `npm start` | backend | start the API (production) |
| `npm test` | backend | API tests (`node:test` + supertest). Needs a local MongoDB; each run uses and drops its own `resume-builder-test-<pid>` database (override with `TEST_MONGODB_URI`) |
| `npm run smoke:cloudinary` | backend | live check of the Cloudinary account with a generated fictional PDF (upload private, signed link, expiry, delete) |
| `npm run smoke:gemini` | backend | live check that `GEMINI_MODEL` (and fallbacks) really generate, then one full analysis of a fictional resume + JD (`-- --models-only` skips the analysis) |
| `npm run dev` | frontend | Vite dev server on :5180 |
| `npm run build` | frontend | production build to `frontend/dist` |
| `npm run preview` | frontend | serve the production build on :4180 |
| `npm run extract`, `npm run render`, `npm run validate` | research/phase1 | re-run the template validation |

## How the frontend talks to the backend

- `frontend/src/utils/env.js` reads `VITE_API_URL` at build time (in dev it falls back to `http://localhost:5000/api`).
- `frontend/src/services/api.js` is the single axios instance. It normalises every failure into an `ApiRequestError` (`status`, `code`, `message`, `isNetworkError`, `isTimeout`).
- Feature services (`services/*.service.js`) call the API. Components never call axios directly.
- The backend allows browser requests only from the origins in `CLIENT_URL` (CORS). Auth (Phase 3) uses an `Authorization: Bearer` header, not cookies. Netlify and Render are different sites, and browsers increasingly block third-party cookies.
- All responses share one envelope: `{ success: true, data }` or `{ success: false, error: { code, message } }`.
- **Cold starts:** Render's free tier sleeps after inactivity. `BackendStatusContext` polls `GET /api/health`, shows "Waking server…" while retrying for up to about 90 s, then reports offline with a retry button.

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | – | liveness + database status |
| POST | `/api/auth/register` | – | create account → `{ user, token, expiresAt }` |
| POST | `/api/auth/login` | – | sign in → `{ user, token, expiresAt }` |
| POST | `/api/auth/logout` | Bearer | revoke all of the user's tokens |
| GET | `/api/auth/me` | Bearer | current user |
| POST | `/api/resumes/upload` | Bearer | first master resume upload (multipart field `resume`, PDF ≤ 5 MB); 409 if one exists |
| GET | `/api/resumes/master` | Bearer | metadata + structured data (`?include=lines` adds the line dump) |
| PUT | `/api/resumes/master` | Bearer | replace the master resume (same multipart format); the previous PDF is kept as a private backup |
| DELETE | `/api/resumes/master` | Bearer | delete the stored PDF, all backups and the record |
| GET | `/api/resumes/master/backups/:backupId/file`, `/download-url` | Bearer | previous master resume PDFs (owner only; integrity-checked) |
| GET | `/api/resumes/master/file` | Bearer | stream the original PDF (owner only; integrity-checked) |
| GET | `/api/resumes/master/download-url` | Bearer | short-lived signed Cloudinary download link |

| POST | `/api/job-analysis` | Bearer | analyse `{ companyName, jobTitle, jobDescription }` (80–20,000 chars) against the master resume; saves and returns the analysis |
| GET | `/api/job-analysis` | Bearer | the user's saved analyses, newest first (`?page=&limit=` ≤ 50), summaries only |
| GET | `/api/job-analysis/:id` | Bearer | one full analysis (404 for unknown or other users' ids) |
| DELETE | `/api/job-analysis/:id` | Bearer | delete one analysis |

## Job description analysis (Phase 4)

```
JD text ──► Gemini (1 structured-JSON call) ──► verification rules ──► score (JavaScript) ──► MongoDB
             JD + redacted resume evidence       keyword in JD? duplicates?   weighted groups      JobAnalysis
             (no name/contact/companies/PDF)     named in resume? relation?
```

- **AI layer** (`backend/services/ai/`): provider-neutral contract and errors; `gemini.provider.js` validates the model (exists, supports generation), sends `responseMimeType: application/json` with a JSON Schema, validates the answer with zod, retries 429 (short waits only), 5xx, timeouts and invalid answers with exponential backoff inside a total time budget, then tries `GEMINI_FALLBACK_MODELS`. Logs contain model, attempt and status only.
- **The AI proposes, rules decide** (`services/job-analysis/requirement-matcher.js` + `skill-taxonomy.js`):
  keywords must appear in the JD; synonyms (ReactJS = React.js) merge; JD phrases are resolved to the known skills they consist of when the rest is only qualifier words ("NestJS framework", "AWS Lambda functions", "Node.js/NestJS" → NestJS, AWS Lambda, Node.js; "GraphQL subscriptions" stays its own requirement); **DIRECT_MATCH** only when the resume names the technology or a more specific part of it (AWS EC2 proves AWS); a concrete technology is either named in the resume (**DIRECT_MATCH**) or **MISSING**: a related technology the resume does name (Express.js for NestJS, AWS EC2 for AWS Lambda) is shown only as context and earns no credit; concepts/practices can be **EXPERIENCE_SUPPORTED** only with evidence ids that exist in the resume.
- **Score** (`scoring.js`): `score = Σ weight × coverage ÷ Σ weight` over the groups present in the JD; coverage = average credit (direct 1.0, experience-supported 0.85, related 0.3, missing 0); weights must-have 50, preferred 20, optional 5, responsibilities 15, years of experience 10. It measures how much of the JD the resume already evidences; it is **not** an ATS score.
- Analyses are snapshots: they record the master resume's file hash and are not rewritten when the resume changes. After a replace they are marked **stale** (`stale: true`, "Outdated" in the UI) and cannot be used for new tailored versions; tailored versions built from an older master (`masterChanged: true`) cannot be approved, turned into a PDF or copied. The master resume is only read.

## Tailored resumes (Phase 5)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/job-analysis/:id/tailored-resumes` | new draft version (AI proposals, all fact-checked) |
| GET | `/api/job-analysis/:id/tailored-resumes`, `/api/tailored-resumes` | version history |
| GET | `/api/tailored-resumes/:id` | proposals, decisions, gaps, keyword coverage before/after, live layout check |
| PATCH | `/api/tailored-resumes/:id/changes/:changeId` | `{ decision: accept\|reject\|reset\|edit, text?, confirmOverride?, confirmReview?, expectedRevision }` |
| POST | `/api/tailored-resumes/:id/accept-all`, `/approve`, `/duplicate` | bulk accept, freeze content, new draft from a version |
| POST/GET | `/api/tailored-resumes/:id/pdf`, `/pdf/download-url` | generate + validate + store privately; stream; signed link |
| DELETE | `/api/tailored-resumes/:id` | delete a version and its PDF |

- **Scope:** summary rewording; skills re-ordering only; experience bullets reworded/re-ordered within their role (same count). Everything else is locked and verified structurally.
- **Claim checker** (`services/tailoring/claim-checker.js`): blocks gap keywords (related ≠ direct), technologies or names not in the cited evidence, bullets using another role's facts, new/changed numbers (decoration and unit must match), new quantities, leadership/seniority inflation, "contributed to" turned into ownership, unprintable characters. AI proposals that fail are repaired once, otherwise blocked. Your own edits that fail need an explicit, recorded override, except a missing skill (gap keyword), which can never be added.
- **Professional identity is locked** (`services/tailoring/meaning-checker.js`): taken from the headline ("Full Stack Developer | …"); the summary must lead with it and may not add other designations. No override can change it. AI summaries must also keep every technology, number and responsibility of the original summary (≥ 80% of its length).
- **Meaning review**: the checker compares the kind of action (built = developed = implemented ≠ optimized ≠ designed ≠ led), new outcomes ("ensuring", "resulting in"), unknown leading verbs and summary skills that only the skills list names. When it cannot confirm the meaning is unchanged, the change is marked *needs review*: "accept all" skips it, accepting or saving it needs an explicit confirmation (recorded in the history), and approval/PDF generation re-check that every such flag was confirmed.
- **Ordering** of skills and bullets is deterministic (no AI), driven by the analysis.
- **PDF** (approved versions only): rendered by `backend/pdf/resume-template.mjs`, a byte-identical copy of the Phase 1 engine (tested), with the Carlito fonts in `backend/assets/fonts`. Before storage: ≤ 2 pages, no overflow, content read back with the Phase 3 extractor equals the approved content, template/fonts/sizes/margins/headings match the master, all claims re-checked, content hash and decisions consistent. Stored as private `raw/authenticated` Cloudinary assets under `resumes/customized/<userId>/`.

## Job application tracker (Phase 6)

| Method | Path | Purpose |
|---|---|---|
| POST / GET | `/api/applications` | create (optionally from `jobAnalysisId` / `tailoredResumeId`) / list: `q`, `status` (comma list), `location`, `source`, `from`, `to`, `sort` (applicationDate, updatedAt, createdAt, companyName, jobTitle), `order`, `page`, `limit` ≤ 50 |
| GET | `/api/applications/board`, `/dashboard?tz=`, `/export.csv` | Kanban columns; dashboard figures; CSV of the filtered list |
| GET / PATCH / DELETE | `/api/applications/:id` | detail / edit fields / delete (only the application) |
| POST | `/api/applications/:id/status`, `/status/undo` | controlled status change / undo the last change |
| PUT | `/api/applications/:id/links` | link or unlink a JobAnalysis and an approved TailoredResume |
| POST / PATCH | `/api/applications/:id/interviews[/:interviewId]`, `…/reschedule`, `…/cancel` | interview rounds |
| POST / PATCH / DELETE | `/api/applications/:id/follow-ups[/:followUpId]` | follow-ups |

- **One document per application** (`models/JobApplication.js`): status history, link history, interview rounds (with reschedule history) and follow-ups are embedded, so every change is a single atomic update guarded by `revision` (`expectedRevision`; 409 `REVISION_CONFLICT` on a stale write). No multi-document transactions are needed (works on standalone MongoDB and Atlas).
- **Status pipeline:** Saved → Applied / Interview / Withdrawn; Applied → Interview / Rejected / Withdrawn; Interview → Selected / Rejected / Withdrawn; Selected → Withdrawn; Rejected and Withdrawn are final. Other moves return 422 `INVALID_STATUS_TRANSITION` with the allowed targets. "Undo" reverts the latest change; history is append-only.
- **Links:** references only (no copies). Only approved or PDF-ready versions of the same analysis can be linked. The job description is copied into the application so it survives the posting. Linked analyses/versions (now or in the link history) cannot be deleted: 409 `LINKED_TO_APPLICATION`. Deleting an application never deletes linked records. PDFs are opened through the existing owner-checked `/api/tailored-resumes/:id/pdf` endpoints.
- **Interviews** are never deleted: they can be rescheduled (old times kept) or cancelled (kept, notes/feedback still editable).
- **Dashboard:** dates and "overdue" use the browser's time zone (`tz`). Interview conversion = reached Interview ÷ reached Applied; selection rate = Selected ÷ reached Interview (history replayed, undone moves excluded).
- **CSV export:** scoped to the signed-in user and the current filters, max 10,000 rows, cells quoted and formula-neutralised (`=`, `+`, `-`, `@` prefixed with `'`), UTF-8 with BOM; job descriptions are not exported.
- No emails or notifications are sent.

**Gemini model:** some model ids are listed by the API but refuse generation ("no longer available to new users"). Run `npm run smoke:gemini` after changing `GEMINI_MODEL`.

**Cloudinary requirements:** the API key must be allowed to upload, destroy and download assets (an Admin key, or a custom role with those permissions). Files are stored as `raw` assets with `authenticated` delivery under `resumes/master/<userId>/<uuid>.pdf`; they have no public URL.

## Deployment

**Netlify (frontend):** base directory `frontend`. Build settings come from `frontend/netlify.toml` (build `npm install && npm run build`, publish `dist`, SPA fallback `/* → /index.html 200`, security headers). Set `VITE_API_URL=https://<your-backend>.onrender.com/api`.

**Phase 6 deployment notes:** no new environment variables or dependencies. Mongoose creates the `jobapplications` indexes on start (`autoIndex`); on a large production database you can create them ahead of time with `JobApplication.syncIndexes()`. The new pages (`/applications…`) are covered by the existing Netlify SPA fallback.

**Render (backend):** root directory `backend`, build `npm ci --omit=dev`, start `npm start`, health check `/api/health`, or use `render.yaml` as a Blueprint. Set `NODE_ENV=production`, `CLIENT_URL` (your exact Netlify URL), `MONGODB_URI`, `JWT_SECRET`, `GEMINI_API_KEY`, `CLOUDINARY_*`. In production the server refuses to start without `CLIENT_URL` and `MONGODB_URI`.

## Privacy & secrets

- `.env` files, resume documents (`*.pdf`, `*.docx`, …), uploads, temp files, extracted resume JSON and research outputs are git-ignored.
- `.githooks/pre-commit` blocks commits that stage such files, or content that looks like a Gemini/Cloudinary/MongoDB credential, even if `.gitignore` is bypassed with `git add -f`.
- `VITE_*` variables end up in public JavaScript, so secrets live only in backend environment variables.
- Gemini is called only from the backend, and receives only the job description and the professional content of the master resume (no name, contact details, company/institution names, locations or PDF). Cloudinary files are private, with short-lived signed links.

## Fonts

PDFs are generated with **Carlito** (SIL Open Font License, `research/phase1/fonts/OFL.txt`), which has the same metrics as Calibri, so line breaks match the original Word layout. See `research/phase1/PHASE1-REPORT.md`.
