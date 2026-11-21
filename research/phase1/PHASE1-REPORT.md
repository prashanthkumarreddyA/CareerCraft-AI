# Phase 1 — Resume & PDF Analysis Report

Source: `original-resume.pdf` (local copy of the master resume; git-ignored)
Date: 2026-11-11

## 1. Exact structure of the original resume

**Document:** PDF 1.7, created by Microsoft Word. 2 pages, US Letter (612 × 792 pt), no images, no hyperlinks, not encrypted, all text extractable.

**Fonts (embedded as subsets):** Calibri, Calibri-Bold, Calibri-Italic. There is also one stray Times New Roman space at the end of contact line 2 (a Word artifact that is not visible). All text is pure black (#000000).

**Page geometry (measured):**

| Property | Value |
|---|---|
| Margins | 72 pt (1 in) on all sides; content width 468 pt (x 72 → 540) |
| Body line pitch | 12.82 pt for 10.5 pt text (Calibri "single" spacing = 1.2207 em) |
| Section rule | filled rectangle, 0.75 pt thick, x 70.5 → 541.7, 3.0 pt below the heading baseline |
| Bullet indent | 12 pt. Bullets are literal `• ` characters. Wrapped lines align with the bullet (no hanging indent) |
| Page 1 break | Last line baseline 711 pt; the next line would cross the 720 pt bottom margin |
| Page 2 fill | Content ends at baseline 608 pt → about 8 body lines of headroom |

**Typography and spacing per element:**

| Element | Font / size | Alignment | Spacing |
|---|---|---|---|
| Name | Calibri Bold 18 | centered | top of page |
| Contact (2 lines) | Calibri 10.5 | centered | 0 |
| Headline | Calibri Bold 10.5 | centered | 4 pt before |
| Section heading (caps) + rule | Calibri Bold 12 | left | 10 pt before, about 4.6 pt after (including border) |
| Summary paragraph | Calibri 10.5 | left | — |
| Skill line `• **Category:** items` | Bold label + regular | left, 12 pt indent | — |
| Entry header `**Company** — Location` / `**Project** \| tech, …` | Bold + regular | left | 6 pt before |
| Role line `*Title* \| Mon YYYY – Mon YYYY` | Italic + regular | left | — |
| Bullet | Calibri 10.5 | left, 12 pt indent | — |

**Section order:** Header → SUMMARY → TECHNICAL SKILLS (7 categories) → PROFESSIONAL EXPERIENCE (2 roles: 10 + 7 bullets) → PROJECTS (3, each with a tech list) → EDUCATION (2) → ACHIEVEMENTS (1).

Structured JSON: [`output/master-resume.json`](output/master-resume.json). Line-level dump with coordinates: [`output/extracted-lines.json`](output/extracted-lines.json).

## 2–4. Can the PDF be edited directly? Which approach preserves the formatting?

### Approach A (edit the original PDF in place): rejected, based on evidence

1. **The embedded fonts are subsets.** Only the glyphs your resume already uses have outlines:

   | Embedded font | Characters it cannot draw |
   |---|---|
   | Calibri (regular) | `K X Y Z # &` (so "Kubernetes", "XML", "C#" are impossible) |
   | Calibri-Bold | `q z Q Z 0-9 # + @ %` (no digits at all) |
   | Calibri-Italic | `b j q x z H J K L N O Q T U V W X Y Z 1-7 9 …` (most job titles are impossible) |

   Any rewritten text that uses one of these characters would render blank or need a substitute font.
2. **No reflow.** Word wrote every line as a separately positioned text fragment. Changing a sentence means re-wrapping the paragraph and shifting everything below it, across the page break. That is a layout engine, not an edit.
3. **pdf-lib cannot edit existing content streams.** It can only draw on top of them, which would mean covering old text with white boxes. That's fragile, and ATS parsers would still read the hidden text.

### Approach B (reusable template that reproduces the original): chosen and validated

I measured the original and wrote a template spec (`resume-template.mjs`, exported to `output/template-metadata.json`). A small layout engine re-implements Word's paragraph model:

- line height and ascent/descent
- space before/after
- bullet indent and centered header lines
- section rules
- breaking at spaces and after in-word hyphens
- widow/orphan control
- keep-with-next for headings, entry headers and role lines

pdf-lib writes the PDF from the structured JSON.

**Validation: original vs generated from the extracted JSON** (`validate.py`, report in `output/validation-carlito/validation-report.json`):

| Check | Result |
|---|---|
| Page count | 2 vs 2 ✅ |
| Page size | 612×792 vs 612×792 ✅ |
| Lines | 81 vs 81, **all 81 identical in text and line-break position** ✅ |
| Baseline position | max Δ 0.61 pt, mean 0.27 pt (0.2 mm max) ✅ |
| Line start x | max Δ 0.07 pt ✅ |
| Line end x | max Δ 0.56 pt ✅ (proves Carlito wraps exactly like Calibri) |
| Overlapping lines | 0 ✅ |
| Text outside margins | 0 ✅ |
| Text extraction (ATS) | Generated PDF extracts to the same 81 lines ✅ |
| Visual overlay | `overlay-page1.png` / `overlay-page2.png`: only sub-point anti-aliasing fringes |
| Same engine with real Calibri (local check only) | identical geometry numbers |

**A bug the visual check caught:** pdf-lib's built-in font subsetter (`subset: true`) silently drops most glyph outlines from Carlito and Calibri. The text still extracts correctly, but the page renders nearly blank. The numeric checks passed; only looking at the rendered page revealed it. The fix is to ship pre-built Latin subsets of Carlito (about 36 KB per face, made with fontTools) and embed them without pdf-lib subsetting. Result: an 85 KB PDF in about 160 ms.

### Fonts: why Carlito, not Calibri

Calibri is a Microsoft font. It can't be bundled with a web app or installed on Render. **Carlito** (SIL Open Font License) is metric-compatible: every character has the same width, so lines break in exactly the same places (proven above: line end x within 0.56 pt).

Glyph shapes are near-identical but not pixel-identical. Side by side you can tell only by looking closely at a few letters. This is the one honest difference from the original. If you'd rather use the real Calibri on your own machine, the engine accepts any TTF.

### Remaining limitations

- The template reproduces **this** layout. If you later upload a resume with a different design, it won't be cloned automatically. The upload flow will detect a mismatch (fonts, sizes, headings) and warn you instead of silently mis-rendering.
- **Two-page budget:** page 2 has about 8 body lines free. The generator will report page count and line usage after every render. If the AI's rewrite overflows, it gets asked to condense, or you'll see a warning. Fonts and spacing are never shrunk.
- **DOCX export** isn't validated yet. It's feasible with the `docx` library, because the original was made in Word. I'll treat it as optional in Phase 6 with its own visual check.

## 5. Libraries

| Purpose | Library | Where |
|---|---|---|
| PDF text and font extraction | `pdfjs-dist` (legacy build), validated here | backend |
| PDF generation | `pdf-lib` + `@pdf-lib/fontkit` + Carlito Latin subsets, validated here | backend (pure JS, no Chromium) |
| PDF preview | `pdfjs-dist` canvas viewer, or an `<iframe>` of the blob | frontend |
| Upload handling | `multer` (memory storage, PDF MIME + `%PDF` magic-byte check, 5 MB cap) | backend |
| AI | `@google/genai` with `responseSchema` structured output, plus `zod` validation | backend |
| Diff view | `diff` (word-level) | frontend |
| Visual regression (development only) | PyMuPDF `validate.py` | developer machine / CI |

Rejected: **Puppeteer/Chromium** (too heavy for Render free tier's 512 MB and cold starts), **HTML + `window.print()`** (output depends on the browser, adds headers and footers, can't be stored server-side), **direct PDF editing** (see above).

## 6. Free-tier limitations to expect (check current quotas before launch; providers change them)

- **Render free web service:** sleeps after about 15 minutes idle, and the first request then takes up to about a minute. It has 512 MB RAM, a fraction of a CPU, and an ephemeral disk. Mitigations: the frontend pings `/api/health` on load and shows a "waking server" state; the JD form is preserved in localStorage; no files are kept on local disk.
- **Netlify:** a static SPA is well within free limits. It needs the SPA redirect (`/* → /index.html 200`).
- **MongoDB Atlas M0:** 512 MB storage, shared CPU, no backups. Resume JSON is only kilobytes per application, so that's fine.
- **Cloudinary free:** monthly credit allowance (storage + bandwidth + transformations). **Free accounts block PDF delivery by default.** We'll upload as `resource_type: raw` with `type: authenticated` and serve through short-lived signed URLs (or stream through the backend). Never public URLs.
- **Gemini API free tier:** low per-minute and per-day request caps that change over time. Each tailored resume will use **one** structured call (analysis, matching and optimization in one response), with retry/backoff on 429/5xx. **Privacy:** Google may use free-tier API inputs to improve its products. Your resume and the JDs would be sent to Gemini; a paid tier avoids that. Model name will be an env var (`GEMINI_MODEL`).

## 7. Final architecture

```
Browser (Netlify, React + Vite + Tailwind)
  ├─ Dashboard / Master resume / New application / Analysis / Compare+Edit / Preview / History
  ├─ pdf.js viewer for previews (PDF bytes come from the backend)
  └─ axios → VITE_API_URL  (JWT in Authorization header; cold-start aware)
        │
Express API (Render)
  ├─ auth (JWT, bcrypt), rate limiting, helmet, CORS = CLIENT_URL only, validators
  ├─ resume upload → pdfjs extraction → template-match check → structured JSON → MongoDB
  │                └─ original PDF → Cloudinary resumes/master (authenticated)
  ├─ generate → gemini.service (1 structured call) → zod validation
  │           → factual guardrails (no new skills/tools/metrics/dates; keyword matching done
  │             deterministically in code so the % is transparent)
  │           → resume-template.service (this Phase 1 engine) → PDF → Cloudinary resumes/customized
  └─ history CRUD with ownership checks; delete removes Cloudinary files too
        │
MongoDB Atlas (User, MasterResume, JobApplication)   Cloudinary (private files)   Gemini API
```

The master resume JSON is never modified by generation. Each `JobApplication` stores only its optimized copy plus a reference to the master.

## Files produced in Phase 1

| File | Purpose |
|---|---|
| `extract.mjs` | pdf.js extractor → structured JSON + line dump (becomes the backend extraction service) |
| `resume-template.mjs` | measured template spec + layout engine + pdf-lib writer (becomes `resume-template.service.js` / `pdf-generation.service.js`) |
| `render.mjs` | CLI: JSON → PDF |
| `validate.py` | visual and geometric regression check (needs `pip install pymupdf`) |
| `fonts/Carlito-*.latin.ttf` | Latin subsets of Carlito (OFL; `OFL.txt` included) |
| `output/master-resume.json` | your master resume as structured data |
| `output/template-metadata.json` | the measured template spec |
| `output/generated-resume.pdf` | generated from the JSON with the template |
| `output/validation-carlito/` | overlay images, page renders, validation report |

Re-run: `npm run extract && npm run render && npm run validate`.

**Privacy note:** `original-resume.pdf`, `output/` and the PNG renders contain your personal details. They'll be git-ignored in Phase 2 unless you tell me otherwise.
