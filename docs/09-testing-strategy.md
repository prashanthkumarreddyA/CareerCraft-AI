# 09 · Testing strategy

## Framework and how to run

- Node's built-in test runner (`node:test`) + `node:assert/strict`, HTTP tests with **supertest**
  against the real Express app from `createApp()`.
- Command (from `backend/`): `npm test` → `node --test "tests/**/*.test.js"`.
- Requires a local MongoDB (`mongodb://127.0.0.1:27017`). Each test process uses and drops its own
  database `resume-builder-test-<pid>` (override with `TEST_MONGODB_URI`; the helper refuses database
  names without "test").
- External services are **never called**: `tests/helpers/fakeAi.js` (scripted Gemini answers, records
  requests, can simulate errors) and `tests/helpers/fakeStorage.js` (in-memory Cloudinary replacement
  with switchable failures) are injected through `createApp({ storage, ai })`.
- Fixtures are fictional: `tests/fixtures/sample-resume.json` (rendered into a PDF on the fly with the
  Phase 1 engine), job descriptions in `tests/fixtures/job-descriptions/`, and
  `tests/helpers/realStructureResume.js` (fictional resume with the same structure as a real one).

> Windows note: piping test output into `head` can hang the runner; redirect to a file instead.

## Verified result

Last verified run (22 Nov 2026, this repository state): **210 tests, 210 passed, 0 failed**
(≈ 95 s). The frontend production build (`npm run build`) also succeeded. No coverage tool is
configured, so no coverage percentage is claimed.

## Test files

| File | `test()` blocks | What it covers |
|---|---|---|
| `app.test.js` | 7 | health, JSON 404 for unknown routes, malformed JSON → 400, CORS allow/deny, preflight methods (incl. PATCH), security headers |
| `config-origins.test.js` | 4 | `CLIENT_URL` parsing (paths stripped, invalid entries dropped) |
| `database-unavailable.test.js` | 2 | 503 `DATABASE_UNAVAILABLE` while MongoDB is down |
| `auth.test.js` | 6 | register (no hash returned), duplicate email, validation never echoes the password, generic login failure, `/me` token checks, logout revokes tokens |
| `extraction.test.js` | 5 | backend extractor equals the Phase 1 extractor; sample resume round trip; image-only → `NO_TEXT`, corrupted → `INVALID_PDF`, non-resume PDF flagged |
| `master-resume.test.js` | 16 | upload/replace/delete, magic bytes, size limits, integrity check, backups, rollback, isolation |
| `gemini-provider.test.js` | 19 | model validation, retries/backoff, fallbacks, timeouts, invalid answers, error mapping (fake SDK client) |
| `job-matching.test.js` | 19 | taxonomy rules: aliases, parent/child, "Express ≠ NestJS", "EC2 ≠ Lambda", concepts, responsibilities, years, scoring formula |
| `job-analysis.test.js` | 15 | the analysis API end to end with a fake AI: persistence, history, staleness, limits, isolation, AI failures |
| `tailoring-content.test.js` | 26 | claim checker rules (gaps, numbers, units, quantities, inflation, unknown terms), generation, ordering, coverage, layout |
| `tailoring-meaning.test.js` | 15 + generated | JD phrase resolution (GraphQL/NestJS/AWS Lambda), identity lock, summary facts, meaning changes, skills-list-only review |
| `tailored-resume.test.js` | 18 | versions, decisions, overrides, review confirmations, approval gate, duplicate, stale master, isolation |
| `tailored-pdf.test.js` | 12 | engine copy is byte-identical, rendering, read-back equality, 2-page limit, tampering, storage + rollback |
| `applications-crud.test.js` | 8 | 6A: validation, CRUD, concurrency, isolation |
| `applications-status.test.js` | 6 | 6B: all 36 status pairs, undo, history, time zones, concurrent moves |
| `applications-links.test.js` | 7 | 6C: linking rules, link history, PDF access, deletion guards, no duplication |
| `applications-interviews.test.js` | 6 | 6D: rounds, results, reschedule history, cancellation, limits |
| `applications-followups-dashboard.test.js` | 6 | 6E: follow-ups, overdue by time zone, dashboard figures with a fixed clock |
| `applications-search-export.test.js` | 6 | 6F: search escaping, filters, sorting, pagination, board, CSV (injection, scoping, headers) |

Some files generate tests in loops (e.g. one test per JD phrasing), which is why the runtime count
(210) is higher than the number of `test()` calls.

## By concern

- **Authentication**: `auth.test.js`, plus a "every endpoint requires authentication" test in each
  feature file.
- **Security / isolation**: cross-user 404 tests in every feature file; CORS tests; upload
  validation; CSV injection; regex escaping; storage ids never returned.
- **AI**: provider behaviour with a fake SDK client (`gemini-provider.test.js`); all analysis and
  tailoring logic with scripted answers, including deliberately wrong AI answers that the rules must
  overrule.
- **Resume engine**: extractor parity with Phase 1; byte-identity of the engine copy.
- **PDF validation**: round-trip extraction, template comparison, page limit, hash tampering.
- **Application tracker**: checkpoints 6A–6F as listed above.

## Regression approach used during development

- **Mutation checks**: guards were disabled one at a time to confirm a test fails (scripts were run
  during development and are not part of the repository).
- **Live smoke tests** (manual, real services, fictional data): `npm run smoke:gemini`,
  `npm run smoke:cloudinary`.
- **Browser testing**: end-to-end runs in headless Chrome against the production build were performed
  during Phases 5 and 6 with Chrome DevTools Protocol scripts. Those scripts were kept outside the
  repository, so these runs **cannot be reproduced from the repository** and their results are not
  claimed here.
- **Frontend**: no unit tests; `npm run build` is the automated check.
- **Phase 1 visual validation**: `research/phase1/validate.py` (PyMuPDF), manual.

## Gaps

No CI pipeline is configured in the repository, no coverage measurement, no frontend component tests,
and no committed browser tests. See [13-future-roadmap.md](13-future-roadmap.md).
