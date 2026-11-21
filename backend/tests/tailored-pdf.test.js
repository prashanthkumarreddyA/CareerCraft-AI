// CHECKPOINT 3 — PDF generation with the unchanged Phase 1 engine: byte-identical engine copy,
// validation gates (pages, overflow, read-back, template, claims), private storage and rollback.
import { test, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import request from 'supertest';
import { startTestApp, stopTestApp, registerUser, auth, uploadPdf } from './helpers/testApp.js';
import { repoRoot, samplePdf, sampleResume } from './helpers/fixtures.js';
import { SECTIONED_ANALYSIS_ANSWER, SECTIONED_JD, sampleAnalysis, tailoringAnswer } from './helpers/tailoringFixtures.js';
import { createFakeAi } from './helpers/fakeAi.js';
import { TailoredResume } from '../models/TailoredResume.js';
import { MasterResume } from '../models/MasterResume.js';
import { generateTailoringProposals } from '../services/tailoring/generate-proposals.js';
import { buildContent, contentHash } from '../services/tailoring/content-builder.js';
import { layoutCheck } from '../services/tailoring/resume-renderer.js';
import { compareWithMaster, renderAndValidate } from '../services/tailored-pdf.service.js';

let app;
let ai;
let storage;
before(async () => ({ app, ai, storage } = await startTestApp()));
after(stopTestApp);
beforeEach(() => {
  ai.reset();
  storage.reset();
  ai.respondWith((req) => ({ 'job-analysis': SECTIONED_ANALYSIS_ANSWER, tailoring: tailoringAnswer(), 'tailoring-repair': { summary: null, bullets: [] } })[req.task]);
});

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

async function approvedVersion({ resume = sampleResume, tailoring } = {}) {
  if (tailoring) ai.respondWith((req) => ({ 'job-analysis': SECTIONED_ANALYSIS_ANSWER, tailoring, 'tailoring-repair': { summary: null, bullets: [] } })[req.task]);
  const s = await registerUser(app);
  await uploadPdf(app, s.token, await samplePdf(resume)).expect(201);
  const analysis = (await request(app).post('/api/job-analysis').set(auth(s.token)).send({ companyName: 'Northwind Labs', jobTitle: 'Senior Backend Engineer', jobDescription: SECTIONED_JD }).expect(201)).body.data.jobAnalysis;
  let v = (await request(app).post(`/api/job-analysis/${analysis.id}/tailored-resumes`).set(auth(s.token)).expect(201)).body.data.tailoredResume;
  const draft = v;
  v = (await request(app).post(`/api/tailored-resumes/${v.id}/accept-all`).set(auth(s.token)).send({ expectedRevision: v.revision }).expect(200)).body.data.tailoredResume;
  const approve = await request(app).post(`/api/tailored-resumes/${v.id}/approve`).set(auth(s.token)).send({ expectedRevision: v.revision });
  return { s, v: approve.body.data?.tailoredResume ?? v, approve, draft };
}
const generate = (s, v) => request(app).post(`/api/tailored-resumes/${v.id}/pdf`).set(auth(s.token));

/** A fictional resume that fills almost two pages, so small growth would need a third page. */
function nearlyTwoPages() {
  const resume = structuredClone(sampleResume);
  // Multi-line filler keeps the role under the 40-bullet schema limit.
  const extra = 'Collaborated with cross-functional teams in two-week Agile sprints, reviewing pull requests, pairing on fixes and writing release notes for every production release of the internal dashboard.';
  while (layoutCheck({ ...resume, experience: resume.experience.map((e, i) => (i === 1 ? { ...e, bullets: [...e.bullets, extra] } : e)) }).pageCount <= 2) {
    resume.experience[1].bullets.push(extra);
  }
  return resume;
}

// ------------------------------------------------------------------ engine reuse
test('the backend engine and fonts are byte-identical copies of the Phase 1 originals', (t) => {
  const research = path.join(repoRoot, 'research/phase1');
  if (!fs.existsSync(research)) return t.skip('research/phase1 not present');
  const backend = path.join(repoRoot, 'backend');
  const same = (a, b) => assert.equal(sha256(fs.readFileSync(a)), sha256(fs.readFileSync(b)), path.basename(a));
  same(path.join(research, 'resume-template.mjs'), path.join(backend, 'pdf/resume-template.mjs'));
  for (const v of ['Regular', 'Bold', 'Italic', 'BoldItalic']) same(path.join(research, `fonts/Carlito-${v}.latin.ttf`), path.join(backend, `assets/fonts/Carlito-${v}.latin.ttf`));
  same(path.join(research, 'fonts/OFL.txt'), path.join(backend, 'assets/fonts/OFL.txt'));
});

test('a version with every change rejected renders exactly like the master resume', async () => {
  const analysis = await sampleAnalysis();
  const fake = createFakeAi();
  fake.respondWith(tailoringAnswer());
  const { changes } = await generateTailoringProposals({ resume: sampleResume, analysis, ai: fake });
  const decided = changes.map((c) => ({ ...c, decision: 'rejected' }));
  const finalContent = buildContent(sampleResume, decided);
  const doc = { baseContent: sampleResume, analysisSnapshot: analysis.matchAnalysis, changes: decided, finalContent, contentHash: contentHash(finalContent) };
  const { validation } = await renderAndValidate(doc);
  assert.equal(validation.passed, true, JSON.stringify(validation.problems));
  assert.equal(validation.comparisonWithMaster.identicalLines, validation.comparisonWithMaster.linesMaster);
  assert.equal(validation.comparisonWithMaster.linesTailored, validation.comparisonWithMaster.linesMaster);
});

test('a version with accepted rewording keeps the master template (fonts, sizes, margins, headings)', async () => {
  // Regression: pdf.js gives fonts per-document ids ("Carlito-Bold-6475"), so different content
  // must still compare as the same font family.
  const analysis = await sampleAnalysis();
  const fake = createFakeAi();
  fake.respondWith(tailoringAnswer());
  const { changes } = await generateTailoringProposals({ resume: sampleResume, analysis, ai: fake });
  const decided = changes.map((c) => ({ ...c, decision: 'accepted' }));
  const finalContent = buildContent(sampleResume, decided);
  const doc = { baseContent: sampleResume, analysisSnapshot: analysis.matchAnalysis, changes: decided, finalContent, contentHash: contentHash(finalContent) };
  const { validation } = await renderAndValidate(doc);
  assert.equal(validation.passed, true, JSON.stringify(validation.problems));
  assert.ok(validation.comparisonWithMaster.identicalLines < validation.comparisonWithMaster.linesMaster); // content really changed
  assert.deepEqual(validation.comparisonWithMaster.fonts, ['Carlito-Bold', 'Carlito-Italic', 'Carlito-Regular']);
});

test('template comparison ignores per-document font ids but detects real font or size changes', () => {
  const doc = (fonts, size = 10.5) => ({
    structuredResumeData: { sectionOrder: [{ key: 'summary', heading: 'SUMMARY' }] },
    extractedContent: { fonts, lines: [{ page: 1, text: 'x', x: 72, baseline: 100, size, runs: [{ text: 'x', bold: false }] }] },
  });
  // Ids seen in a live run: same families, different pdf-lib suffixes.
  const live = compareWithMaster(doc(['Carlito-Bold-6475', 'Carlito-Regular-7264']), doc(['Carlito-Bold-7264', 'Carlito-Regular-3800']));
  assert.equal(live.sameFontsAndSizes, true);
  assert.equal(compareWithMaster(doc(['Arial-Bold-1']), doc(['Carlito-Bold-2'])).sameFontsAndSizes, false);
  assert.equal(compareWithMaster(doc(['Carlito-Bold-1'], 11), doc(['Carlito-Bold-2'])).sameFontsAndSizes, false);
});

test('PDF gate rejects >2 pages, tampered content and content not produced by decisions', async () => {
  const base = nearlyTwoPages();
  const analysis = await sampleAnalysis(base);
  const longEdit = {
    changeId: 'bullet-2-4',
    type: 'bullet',
    target: { type: 'bullet', roleIndex: 1, bulletIndex: 3 },
    original: base.experience[1].bullets[3],
    proposed: base.experience[1].bullets[3],
    decision: 'edited',
    editedText: `${'Collaborated with cross-functional teams in two-week Agile sprints and '.repeat(5)}shipped features.`,
    override: { confirmed: true, issues: [] },
    evidenceIds: ['exp.2.4'],
    validation: { passed: true, issues: [] },
  };
  const finalContent = buildContent(base, [longEdit]);
  const doc = { baseContent: base, analysisSnapshot: analysis.matchAnalysis, changes: [longEdit], finalContent, contentHash: contentHash(finalContent) };
  const tooLong = await renderAndValidate(doc);
  assert.equal(tooLong.validation.passed, false);
  assert.ok(tooLong.validation.problems.some((p) => p.code === 'TOO_MANY_PAGES'));
  assert.ok(tooLong.validation.problems.some((p) => p.code === 'LAYOUT_INVALID'));

  const tampered = structuredClone(doc);
  tampered.finalContent.experience[0].bullets[0] = 'Invented bullet.';
  const t = await renderAndValidate(tampered);
  assert.ok(t.validation.problems.some((p) => p.code === 'CONTENT_HASH_MISMATCH'));
  tampered.contentHash = contentHash(tampered.finalContent); // even with a matching hash…
  const t2 = await renderAndValidate(tampered);
  assert.ok(t2.validation.problems.some((p) => p.code === 'CONTENT_NOT_FROM_DECISIONS')); // …it must come from decisions
});

// ------------------------------------------------------------------ approval-time page budget (API)
test('approval is blocked when accepted edits would push the resume past two pages', async () => {
  const base = nearlyTwoPages();
  const tailoring = { summary: null, bullets: [{ id: 'exp.2.4', text: 'Collaborated with cross-functional teams across two-week Agile sprints.', evidenceIds: ['exp.2.4'], targetedKeywords: [], rationale: 'Clearer.' }] };
  const { s, draft } = await approvedVersion({ resume: base, tailoring });
  // Reset to draft decisions: start over with a fresh version and a long (overridden) edit.
  const id = draft.id;
  let v = (await request(app).get(`/api/tailored-resumes/${id}`).set(auth(s.token))).body.data.tailoredResume;
  if (v.status !== 'draft') {
    v = (await request(app).post(`/api/tailored-resumes/${id}/duplicate`).set(auth(s.token)).expect(201)).body.data.tailoredResume;
  }
  const long = `${'Collaborated with cross-functional teams in two-week Agile sprints and '.repeat(5)}shipped features.`;
  v = (await request(app).patch(`/api/tailored-resumes/${v.id}/changes/bullet-2-4`).set(auth(s.token)).send({ decision: 'edit', text: long, confirmOverride: true, expectedRevision: v.revision }).expect(200)).body.data.tailoredResume;
  assert.equal(v.layout.passed, false); // shown live during review
  const res = await request(app).post(`/api/tailored-resumes/${v.id}/approve`).set(auth(s.token)).send({ expectedRevision: v.revision }).expect(422);
  assert.ok(res.body.error.details.problems.some((p) => p.code === 'LAYOUT_INVALID' && /maximum is 2/.test(p.message)));
});

// ------------------------------------------------------------------ PDF API
test('PDF only after approval; validated, stored privately, streamed with integrity check', async () => {
  const { s, v, approve, draft } = await approvedVersion();
  assert.equal(approve.status, 200);
  const masterBefore = await MasterResume.findOne({ userId: s.user.id }).lean();
  const masterFileBefore = storage.files.get(masterBefore.cloudinaryPublicId);

  // Draft versions cannot produce a PDF.
  const d2 = (await request(app).post(`/api/tailored-resumes/${v.id}/duplicate`).set(auth(s.token)).expect(201)).body.data.tailoredResume;
  assert.equal((await generate(s, d2).expect(409)).body.error.code, 'NOT_APPROVED');
  assert.ok(draft);

  const res = await generate(s, v).expect(201);
  const t = res.body.data.tailoredResume;
  assert.equal(t.status, 'pdf_ready');
  assert.equal(t.pdf.templateId, 'classic-v1');
  assert.ok(t.pdf.pageCount <= 2);
  const val = t.pdf.validation;
  assert.equal(val.passed, true, JSON.stringify(val.problems));
  assert.equal(val.roundTrip.identical, true);
  assert.equal(val.template.compatible, true);
  assert.equal(val.comparisonWithMaster.sameFontsAndSizes, true);
  assert.equal(val.comparisonWithMaster.sameLeftMargin, true);
  assert.equal(val.comparisonWithMaster.sameHeadings, true);

  const doc = await TailoredResume.findById(v.id).lean();
  assert.ok(doc.pdf.cloudinaryPublicId.startsWith(`resumes/customized/${s.user.id}/`));
  assert.equal('cloudinaryPublicId' in t.pdf, false); // storage ids are never exposed

  const file = await request(app).get(`/api/tailored-resumes/${v.id}/pdf`).set(auth(s.token)).buffer(true).parse((r, cb) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  }).expect(200);
  assert.equal(file.headers['content-type'], 'application/pdf');
  assert.match(file.headers['cache-control'], /no-store/);
  assert.match(file.headers['content-disposition'], /resume-Northwind-Labs-v1\.pdf/);
  assert.equal(sha256(file.body), doc.pdf.fileHash);

  const link = await request(app).get(`/api/tailored-resumes/${v.id}/pdf/download-url`).set(auth(s.token)).expect(200);
  assert.ok(link.body.data.url && link.body.data.expiresAt);
  assert.equal((await generate(s, v).expect(409)).body.error.code, 'PDF_EXISTS');

  // The master resume (record and file) is untouched.
  assert.deepEqual(await MasterResume.findOne({ userId: s.user.id }).lean(), masterBefore);
  assert.ok(storage.files.get(masterBefore.cloudinaryPublicId).equals(masterFileBefore));

  storage.corruptOnFetch = true;
  assert.equal((await request(app).get(`/api/tailored-resumes/${v.id}/pdf`).set(auth(s.token)).expect(502)).body.error.code, 'FILE_INTEGRITY_ERROR');
});

test('PDF endpoints are owner-only', async () => {
  const { s, v } = await approvedVersion();
  await generate(s, v).expect(201);
  const other = await registerUser(app);
  await generate(other, v).expect(404);
  await request(app).get(`/api/tailored-resumes/${v.id}/pdf`).set(auth(other.token)).expect(404);
  await request(app).get(`/api/tailored-resumes/${v.id}/pdf/download-url`).set(auth(other.token)).expect(404);
});

test('tampered approved content fails validation: nothing is stored', async () => {
  const { s, v } = await approvedVersion();
  await TailoredResume.updateOne({ _id: v.id }, { $set: { 'finalContent.experience.0.bullets.0': 'Led a team of 50 engineers.' } });
  const uploadsBefore = storage.uploads.length;
  const res = await generate(s, v).expect(422);
  assert.equal(res.body.error.code, 'PDF_VALIDATION_FAILED');
  assert.ok(res.body.error.details.problems.some((p) => p.code === 'CONTENT_HASH_MISMATCH'));
  assert.equal(storage.uploads.length, uploadsBefore);
  const doc = await TailoredResume.findById(v.id).lean();
  assert.equal(doc.status, 'approved');
  assert.equal(doc.pdf.validation.passed, false);
  await request(app).get(`/api/tailored-resumes/${v.id}/pdf`).set(auth(s.token)).expect(404);
});

test('storage failure leaves the version approved without a PDF', async () => {
  const { s, v } = await approvedVersion();
  storage.failUpload = true;
  assert.equal((await generate(s, v).expect(502)).body.error.code, 'STORAGE_ERROR');
  const doc = await TailoredResume.findById(v.id).lean();
  assert.equal(doc.status, 'approved');
  assert.equal(doc.pdf?.cloudinaryPublicId, undefined);
});

test('database failure after upload deletes the uploaded PDF (no orphans)', async () => {
  const { s, v } = await approvedVersion();
  const update = mock.method(TailoredResume, 'updateOne', async () => {
    throw Object.assign(new Error('connection reset'), { name: 'MongoNetworkError' });
  });
  try {
    await generate(s, v).expect(503);
  } finally {
    update.mock.restore();
  }
  const uploaded = storage.uploads.at(-1);
  assert.ok(uploaded.startsWith('resumes/customized/'));
  assert.ok(storage.deletes.includes(uploaded));
  assert.equal(storage.files.has(uploaded), false);
});

test('deleting a version deletes its PDF; a storage failure keeps the record for retry', async () => {
  const { s, v } = await approvedVersion();
  await generate(s, v).expect(201);
  const publicId = (await TailoredResume.findById(v.id).lean()).pdf.cloudinaryPublicId;
  storage.failDelete = true;
  await request(app).delete(`/api/tailored-resumes/${v.id}`).set(auth(s.token)).expect(502);
  assert.ok(await TailoredResume.exists({ _id: v.id }));
  storage.failDelete = false;
  await request(app).delete(`/api/tailored-resumes/${v.id}`).set(auth(s.token)).expect(200);
  assert.equal(storage.files.has(publicId), false);
  assert.equal(await TailoredResume.exists({ _id: v.id }), null);
});
