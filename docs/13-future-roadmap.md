# 13 · Future roadmap

**Nothing in this document is implemented.** These are suggestions and plans, kept separate from the
features described in [03-phase-wise-features.md](03-phase-wise-features.md).

## Phase 7 – AI Interview Preparation (planned, not implemented)

Phase 7 has been named as the next phase but **has not started**; there is no code, model, route or
page for it. Any scope below is a suggestion to be agreed before implementation:

- interview questions generated from a saved job analysis and the tailored resume, grounded in the
  same evidence ids (so answers never claim experience the resume does not show);
- practice notes per application interview round (the tracker already stores rounds);
- the same "AI proposes, rules verify" approach and per-user AI rate limits.

## Phase 8

The project was planned in 8 phases. Phase 8's scope is not defined in the repository.

## Security follow-ups

- Credential rotation and pre-commit hook improvements (postponed to a final security clean-up).
- Content-Security-Policy on Netlify; consider refresh tokens and shorter access tokens.
- Account management: password change/reset, email verification, account deletion (including
  Cloudinary files).
- Shared rate-limit store for multi-instance deployments; dependency scanning.

## Product ideas

- Email or in-app reminders for follow-ups and interviews (currently none are sent).
- DOCX export (mentioned as optional in the Phase 1 report).
- Additional resume templates (only `classic-v1` can be regenerated today).
- Editing the master resume content in the app (today it changes only by uploading a new PDF).
- Saving job-description drafts in the browser.

## Engineering

- CI pipeline (backend tests + frontend build on every push).
- Commit the browser end-to-end tests to the repository.
- Frontend tests (components and hooks).
- Route-level code splitting (the bundle is ~560 kB).
- Background workers/queue for AI calls and PDF rendering; MongoDB aggregation for dashboards at scale.
- Store AI token usage for cost monitoring.
