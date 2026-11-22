# 08 · Security and privacy

Based on the code as it is. Recommendations are listed separately at the end.

## Passwords

- bcrypt (`bcryptjs`) with cost `BCRYPT_ROUNDS` (default 12); hashes are `select: false`.
- Passwords 8–128 characters; never logged or returned.
- Login compares against a dummy hash when the email is unknown, so response time does not reveal
  which emails are registered; the error is the same (`INVALID_CREDENTIALS`).

## JWT

- HS256 only (`algorithms: ['HS256']` on verify), secret `JWT_SECRET` (production refuses to start
  without it; warns if shorter than 32 characters; `render.yaml` generates one).
- Claims: `sub` (user id), `tv` (token version), `exp` (`JWT_EXPIRES_IN`, default 7 days).
- Every request re-loads the user and compares `tv` with `tokenVersion`; logout increments it, which
  revokes **all** of the user's tokens. There are no refresh tokens.
- Outside production a missing secret falls back to a random per-process secret (sessions end on restart).

## Authentication middleware and authorisation

- `requireAuth` accepts only `Authorization: Bearer <token>` and sets `req.user = { id, name, email }`.
- All resume, analysis, tailoring and application routes use `requireAuth` at router level.
- Authorisation is **ownership**: every query includes `userId: req.user.id`; another user's id and a
  malformed id both return 404 (see [04](04-database-design.md#how-user-ownership-is-enforced)).
- Linked records (analysis ↔ application ↔ tailored version) are resolved inside the same user's data.

## CORS

- Only origins listed in `CLIENT_URL` (comma-separated). Each entry is reduced to its origin
  (`https://site.netlify.app/login` → `https://site.netlify.app`), invalid entries are dropped; both
  are reported at start-up.
- Requests without an `Origin` header (curl, health checks) are allowed; CORS is a browser control,
  authentication protects the data.
- `credentials: false` (no cookies), allowed headers `Content-Type`, `Authorization`, methods
  GET/POST/PUT/PATCH/DELETE/OPTIONS.

## Rate limiting

`express-rate-limit`, in-memory per process: general 300/15 min per IP, auth 20/15 min per IP,
uploads and PDF generation 20/hour per user, AI 30/hour per user. `TRUST_PROXY=1` on Render so the
client IP is used. See the table in [05](05-backend-api-reference.md#conventions).

## Input validation

- zod strict schemas for every body (unknown keys rejected), query schemas for lists; text is cleaned
  of control characters; lengths bounded everywhere; ids validated as 24-hex ObjectIds.
- URLs (job URL, meeting link) must be `http:`/`https:` (blocks `javascript:` etc.); links in the UI
  open with `rel="noopener noreferrer"`.
- Search input is regex-escaped before building MongoDB queries.
- AI answers are validated with zod like user input.
- Validation errors report field paths, never submitted values; Mongoose errors are reduced to field names.

## File uploads

- multer **memory storage** only (nothing written to disk), 1 file, field `resume`, ≤ 5 MB, limited
  fields/parts.
- MIME allow-list plus the `%PDF` signature in the first 1024 bytes.
- Parsed by pdf.js; encrypted/scanned/unsupported PDFs are rejected with typed errors.
- File names are sanitised and never used in storage paths.

## Cloudinary private storage and signed URLs

- `raw` + `authenticated` delivery: no public URL; random UUID public ids per user folder.
- Downloads: backend stream after ownership and SHA-256 integrity checks, or signed URLs valid
  `SIGNED_URL_TTL_SECONDS` (default 300 s). Storage ids are never sent to the browser.
- The API secret stays on the server. Failed DB writes after an upload trigger deletion of the
  uploaded file (compensation).

## API keys and environment variables

- Gemini, Cloudinary, MongoDB and JWT secrets exist only in backend environment variables
  (Render dashboard / local `backend/.env`, git-ignored).
- `VITE_*` variables are compiled into public JavaScript: only `VITE_API_URL` is used, no secrets.
- `.githooks/pre-commit` blocks committing `.env` files, documents (`.pdf`, `.docx`, …), research
  outputs and content that looks like a Gemini key, MongoDB URI with credentials, Cloudinary URL,
  private key or `*_SECRET=` assignment.

## CSV formula injection

Every exported cell is quoted; cells starting with `=`, `+`, `-`, `@`, tab or carriage return get a
leading `'` so spreadsheet applications treat them as text. Export is user-scoped and `no-store`.

## Sensitive information in logs

- Request logs: method, path without query string, status, size, duration.
- Health requests are not logged in production.
- AI logs: task, model, attempt, error kind, latency – never prompts or answers.
- Error logs only for 5xx, with library error messages; no stack traces in production.
- Messages of `ApiError` and extraction errors are written to contain no resume text.

## Data deletion and retention

See [04](04-database-design.md#retention-and-deletion). Users can delete their master resume (incl.
backups), analyses, tailored versions (incl. PDFs) and applications. Linked records are protected
from deletion to keep application history intact.

## Other headers and hardening

`helmet()` defaults, `x-powered-by` disabled, JSON body limit 1 MB, Netlify headers
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
`Permissions-Policy`, production source maps disabled (`build.sourcemap: false`).

## Known limitations and recommended improvements

| Area | Current state | Consider |
|---|---|---|
| Token storage | JWT in `localStorage` (XSS-readable) | strict Content-Security-Policy on Netlify; or a same-site cookie setup behind one domain |
| Sessions | 7-day tokens, no refresh, logout revokes all devices | shorter tokens + refresh tokens; per-device revocation |
| Account lifecycle | no email verification, password reset, password change or account deletion endpoint | add them (deletion should also remove Cloudinary files) |
| Rate limiting | in-memory per instance; resets on restart | shared store (e.g. Redis) when running more than one instance |
| PDF parsing | pdf.js runs in the API process on untrusted files (5 MB cap) | parse in a worker with a time limit |
| AI data | resume content sent to Gemini; provider terms apply | paid tier / data-processing terms for real users; user consent text |
| Secrets | the user noted a credential rotation and hook improvements as a pending "final security cleanup" task | rotate Cloudinary credentials; keep `.env.example` free of real values |
| Audit | no audit log of logins or deletions | add security event logging (without personal data) |
| Dependency scanning | none configured | `npm audit` / Dependabot in CI |
