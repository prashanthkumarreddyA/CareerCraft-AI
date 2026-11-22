# 11 · Local development setup

## Prerequisites

- **Node.js 20.19+ or 22.12+** (Vite 8 requirement; both `package.json` files declare `>=20.19.0`; tested with 22).
- npm 10+, Git.
- **MongoDB**: a local server on `127.0.0.1:27017` (required for the test suite) or an Atlas cluster.
- Optional: a Gemini API key (analysis/tailoring), a Cloudinary account (uploads), Python 3 +
  `pip install pymupdf` (only for `research/phase1/validate.py`).

## 1. Clone and enable the privacy hook

```bash
git clone https://github.com/prashanthkumarreddyA/CareerCraft-AI.git
cd CareerCraft-AI
git config core.hooksPath .githooks     # blocks committing resumes and credentials
```

## 2. Backend

```bash
cd backend
npm install
cp .env.example .env      # Windows PowerShell: Copy-Item .env.example .env
```

Edit `backend/.env` (placeholders shown):

```dotenv
NODE_ENV=development
PORT=5000
CLIENT_URL=http://localhost:5180,http://localhost:4180
MONGODB_URI=mongodb://127.0.0.1:27017/resume-builder
JWT_SECRET=<at least 32 random characters>
GEMINI_API_KEY=<your key>
GEMINI_MODEL=<model id that passes npm run smoke:gemini>
CLOUDINARY_CLOUD_NAME=<cloud name>
CLOUDINARY_API_KEY=<key>
CLOUDINARY_API_SECRET=<your secret>
```

Generate a secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.

Without Gemini or Cloudinary the server still starts; the dependent features return 503
(`AI_NOT_CONFIGURED`, `STORAGE_NOT_CONFIGURED`).

```bash
npm run dev        # node --watch server.js → http://localhost:5000
# or: npm start
```

Check: <http://localhost:5000/api/health>.

## 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env.local     # VITE_API_URL=http://localhost:5000/api
npm run dev                    # http://localhost:5180 (strict port)
```

Without `.env.local` the dev server also defaults to `http://localhost:5000/api`.

## 4. Scripts

| Where | Command | Purpose |
|---|---|---|
| backend | `npm run dev` | API with auto-restart |
| backend | `npm start` | API (production mode depends on `NODE_ENV`) |
| backend | `npm test` | full test suite (needs local MongoDB) |
| backend | `npm run smoke:gemini` (`-- --models-only`) | live Gemini check with fictional data |
| backend | `npm run smoke:cloudinary` | live Cloudinary check with a generated PDF |
| frontend | `npm run dev` | Vite dev server :5180 |
| frontend | `npm run build` | production build to `frontend/dist` (set `VITE_API_URL`) |
| frontend | `npm run preview` | serve the build on :4180 |
| research/phase1 | `npm run extract`, `npm run render`, `npm run validate` | Phase 1 tools (need the private original PDF, not in Git) |

## 5. Tests and build

```bash
cd backend && npm test > test-output.txt 2>&1    # redirect on Windows; piping to head can hang
cd ../frontend && VITE_API_URL=http://localhost:5000/api npm run build
```

Tests use a throwaway database per run and never call Gemini or Cloudinary
([09-testing-strategy.md](09-testing-strategy.md)).

## Troubleshooting

| Problem | Fix |
|---|---|
| `Port 5180 is already in use` | another Vite instance is running (strict port); stop it |
| Backend `EADDRINUSE :5000` or an old server still answering | stop the old Node process (on Windows check with `Get-CimInstance Win32_Process -Filter "Name='node.exe'"`); compare `uptimeSeconds` in `/api/health` |
| Browser CORS error locally | add your frontend origin to `CLIENT_URL` |
| Tests fail with connection errors | start MongoDB locally or set `TEST_MONGODB_URI` (name must contain "test") |
| Health shows `database: not_configured` | `MONGODB_URI` is missing |
| `JWT_SECRET is not set` warning, sessions lost on restart | set `JWT_SECRET` |
| Upload returns `STORAGE_NOT_CONFIGURED` | Cloudinary variables missing |
| Analysis returns `AI_MODEL_UNAVAILABLE` | run `npm run smoke:gemini`, change `GEMINI_MODEL` |
| Uploaded resume shows "Layout differs from the supported template" | the PDF is not the `classic-v1` layout; analysis and tailoring still work, but tailored PDFs are always rendered in the `classic-v1` layout and will not look like the uploaded design |
| Transactions errors | not expected: the code does not use multi-document transactions |
