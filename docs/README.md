# CareerCraft AI documentation

This folder documents the application **as implemented in this repository** (Phases 1–6). Every
statement was checked against the source code. Where something was planned but not built, the
documents say so explicitly.

| # | Document | Read it when you want to… |
|---|---|---|
| 01 | [Project overview](01-project-overview.md) | understand what the app does, for whom, and the end-to-end user journey |
| 02 | [System architecture](02-system-architecture.md) | see how browser, API, database, Gemini and Cloudinary fit together (with flow diagrams) |
| 03 | [Phase-wise features](03-phase-wise-features.md) | understand each feature and its business rules, phase by phase |
| 04 | [Database design](04-database-design.md) | look up a Mongoose model, its fields, indexes and ownership rules |
| 05 | [Backend API reference](05-backend-api-reference.md) | call or change an endpoint |
| 06 | [AI architecture](06-ai-architecture.md) | understand prompts, structured output, retries and what the AI may and may not decide |
| 07 | [Frontend architecture](07-frontend-architecture.md) | work on React pages, routing, state or API calls |
| 08 | [Security and privacy](08-security-and-privacy.md) | review authentication, isolation, storage, logging and known gaps |
| 09 | [Testing strategy](09-testing-strategy.md) | run, read or extend the test suite |
| 10 | [Deployment guide](10-deployment-guide.md) | deploy or troubleshoot Netlify / Render / Atlas / Cloudinary / Gemini |
| 11 | [Local development setup](11-local-development-setup.md) | run the project on your machine |
| 12 | [Technical interview guide](12-technical-interview-guide.md) | present the project and answer technical questions |
| 13 | [Future roadmap](13-future-roadmap.md) | see what is **not** built yet (Phase 7 and other ideas) |

## Conventions used in these documents

- **Implemented** means the code exists in this repository and is covered by tests unless stated otherwise.
- **Partial** means some of the behaviour exists; the gap is described next to it.
- **Planned / not implemented** means it appears only in plans or reports (for example
  `research/phase1/PHASE1-REPORT.md`), not in the running code.
- File paths are relative to the repository root, e.g. `backend/services/tailoring/claim-checker.js`.
- Secrets are never shown. Environment variables are listed by name with placeholders.
- Examples use fictional people, companies and resumes (the same fixtures the tests use).

## Repository map

```
.
├── backend/                 Express 5 API (Render)
│   ├── app.js / server.js   app factory / process entry point
│   ├── config/              env parsing, CORS, MongoDB connection
│   ├── routes/ controllers/ HTTP layer (thin)
│   ├── services/            business logic (auth, resumes, AI, tailoring, PDF, applications)
│   ├── models/              Mongoose schemas (5 collections)
│   ├── validators/          zod request schemas
│   ├── middleware/          auth, rate limits, upload, validation, errors, logging
│   ├── pdf/                 byte-identical copy of the Phase 1 PDF engine
│   ├── assets/fonts/        Carlito Latin subsets (SIL OFL)
│   ├── scripts/             live smoke tests (Gemini, Cloudinary)
│   └── tests/               node:test + supertest suite
├── frontend/                React 19 + Vite + Tailwind SPA (Netlify)
├── research/phase1/         Phase 1 analysis: extractor, template engine, validator, report
├── docs/                    this documentation
├── .githooks/pre-commit     blocks committing resumes and credentials
└── render.yaml              Render Blueprint for the backend
```
