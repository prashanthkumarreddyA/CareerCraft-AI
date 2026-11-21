// CHECKPOINT 6C — links to JobAnalysis / TailoredResume: validation, history, PDF access,
// deletion guards, no duplication, master resume untouched. Fake AI + fake storage.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import request from 'supertest';
import { startTestApp, stopTestApp, registerUser, auth, uploadPdf } from './helpers/testApp.js';
import { samplePdf } from './helpers/fixtures.js';
import { SECTIONED_ANALYSIS_ANSWER, SECTIONED_JD, tailoringAnswer } from './helpers/tailoringFixtures.js';
import { MasterResume } from '../models/MasterResume.js';
import { JobAnalysis } from '../models/JobAnalysis.js';
import { TailoredResume } from '../models/TailoredResume.js';
import { JobApplication } from '../models/JobApplication.js';

let app;
let ai;
let storage;
before(async () => ({ app, ai, storage } = await startTestApp()));
after(stopTestApp);
const REPAIR = { summary: null, bullets: [] };
beforeEach(() => {
  ai.reset();
  ai.respondWith((req) => ({ 'job-analysis': SECTIONED_ANALYSIS_ANSWER, tailoring: tailoringAnswer(), 'tailoring-repair': REPAIR })[req.task]);
});

const api = (token) => ({
  get: (p) => request(app).get(p).set(auth(token)),
  post: (p, body = {}) => request(app).post(p).set(auth(token)).send(body),
  put: (p, body = {}) => request(app).put(p).set(auth(token)).send(body),
  del: (p) => request(app).delete(p).set(auth(token)),
});

/** User with a master resume, one analysis and versions: draft, approved, and PDF-ready. */
async function setup() {
  const user = await registerUser(app);
  const a = api(user.token);
  await uploadPdf(app, user.token, await samplePdf()).expect(201);
  const analysis = (await a.post('/api/job-analysis', { companyName: 'Northwind Labs', jobTitle: 'Senior Backend Engineer', jobDescription: SECTIONED_JD }).expect(201)).body.data.jobAnalysis;
  const version = async (stage) => {
    let v = (await a.post(`/api/job-analysis/${analysis.id}/tailored-resumes`).expect(201)).body.data.tailoredResume;
    if (stage === 'draft') return v;
    v = (await a.post(`/api/tailored-resumes/${v.id}/accept-all`, { expectedRevision: v.revision }).expect(200)).body.data.tailoredResume;
    v = (await a.post(`/api/tailored-resumes/${v.id}/approve`, { expectedRevision: v.revision }).expect(200)).body.data.tailoredResume;
    if (stage === 'approved') return v;
    return (await a.post(`/api/tailored-resumes/${v.id}/pdf`).expect(201)).body.data.tailoredResume;
  };
  return { ...user, a, analysis, draft: await version('draft'), approved: await version('approved'), pdf: await version('pdf') };
}

const counts = async () => [await JobAnalysis.countDocuments(), await TailoredResume.countDocuments(), await MasterResume.countDocuments()];

test('create from an analysis: prefilled (job description copied), linked by reference, nothing duplicated', async () => {
  const s = await setup();
  const before = await counts();
  const masterBefore = await MasterResume.findOne({ userId: s.user.id }).lean();
  const app1 = (await s.a.post('/api/applications', { jobAnalysisId: s.analysis.id, tailoredResumeId: s.pdf.id }).expect(201)).body.data.application;
  assert.deepEqual([app1.companyName, app1.jobTitle], ['Northwind Labs', 'Senior Backend Engineer']);
  assert.equal(app1.jobDescription, SECTIONED_JD.replace(/\r\n?/g, '\n').trim());
  assert.deepEqual([app1.jobAnalysisId, app1.tailoredResumeId], [s.analysis.id, s.pdf.id]);
  assert.deepEqual(app1.links.jobAnalysis, { ...app1.links.jobAnalysis, id: s.analysis.id, matchPercentage: s.analysis.matchPercentage, stale: false });
  assert.deepEqual(app1.links.tailoredResume, { ...app1.links.tailoredResume, id: s.pdf.id, versionNumber: s.pdf.versionNumber, status: 'pdf_ready', hasPdf: true, masterChanged: false });
  assert.ok(!JSON.stringify(app1).includes('cloudinary') && !JSON.stringify(app1).includes('resumes/customized'), 'no storage ids or URLs');
  // Fields given explicitly win over the analysis.
  const app2 = (await s.a.post('/api/applications', { jobAnalysisId: s.analysis.id, companyName: 'Northwind (EU)' }).expect(201)).body.data.application;
  assert.equal(app2.companyName, 'Northwind (EU)');
  // The version alone is enough: its analysis is linked too.
  const app3 = (await s.a.post('/api/applications', { tailoredResumeId: s.approved.id }).expect(201)).body.data.application;
  assert.equal(app3.jobAnalysisId, s.analysis.id);
  assert.deepEqual(await counts(), before);
  assert.deepEqual(await MasterResume.findOne({ userId: s.user.id }).lean(), masterBefore);
});

test('only approved or PDF-ready versions can be linked; mismatched or foreign references are refused', async () => {
  const s = await setup();
  const other = await setup();
  const a = (await s.a.post('/api/applications', { companyName: 'C', jobTitle: 'T' }).expect(201)).body.data.application;
  const put = (body) => s.a.put(`/api/applications/${a.id}/links`, { jobAnalysisId: null, tailoredResumeId: null, expectedRevision: 0, ...body });
  assert.equal((await put({ tailoredResumeId: s.draft.id }).expect(422)).body.error.code, 'VERSION_NOT_APPROVED');
  assert.equal((await put({ jobAnalysisId: other.analysis.id }).expect(404)).body.error.code, 'JOB_ANALYSIS_NOT_FOUND');
  assert.equal((await put({ tailoredResumeId: other.pdf.id }).expect(404)).body.error.code, 'TAILORED_RESUME_NOT_FOUND');
  assert.equal((await put({ jobAnalysisId: other.analysis.id, tailoredResumeId: s.pdf.id }).expect(422)).body.error.code, 'LINK_MISMATCH');
  await put({ jobAnalysisId: 'not-an-id' }).expect(400);
  await s.a.post('/api/applications', { tailoredResumeId: other.pdf.id }).expect(404);
  await s.a.post('/api/applications', { companyName: 'C', jobTitle: 'T', tailoredResumeId: s.draft.id }).expect(422);
  assert.equal((await JobApplication.findById(a.id).lean()).revision, 0);
});

test('changing links keeps a complete link history; status changes never touch links', async () => {
  const s = await setup();
  let a = (await s.a.post('/api/applications', { tailoredResumeId: s.approved.id }).expect(201)).body.data.application;
  a = (await s.a.post(`/api/applications/${a.id}/status`, { status: 'applied', expectedRevision: a.revision }).expect(200)).body.data.application;
  a = (await s.a.post(`/api/applications/${a.id}/status`, { status: 'interview', expectedRevision: a.revision }).expect(200)).body.data.application;
  assert.equal(a.tailoredResumeId, s.approved.id);
  a = (await s.a.put(`/api/applications/${a.id}/links`, { jobAnalysisId: s.analysis.id, tailoredResumeId: s.pdf.id, expectedRevision: a.revision }).expect(200)).body.data.application;
  assert.equal(a.tailoredResumeId, s.pdf.id);
  assert.deepEqual(a.linkHistory.map((l) => [l.tailoredResumeId, l.versionNumber]), [[s.approved.id, s.approved.versionNumber]]);
  // Same links again: no-op (no history entry, no revision bump).
  const same = (await s.a.put(`/api/applications/${a.id}/links`, { jobAnalysisId: s.analysis.id, tailoredResumeId: s.pdf.id, expectedRevision: a.revision }).expect(200)).body.data.application;
  assert.equal(same.revision, a.revision);
  // Unlink everything: kept in history.
  a = (await s.a.put(`/api/applications/${a.id}/links`, { jobAnalysisId: null, tailoredResumeId: null, expectedRevision: a.revision }).expect(200)).body.data.application;
  assert.deepEqual([a.jobAnalysisId, a.tailoredResumeId, a.links.jobAnalysis], [null, null, null]);
  assert.deepEqual(a.linkHistory.map((l) => l.tailoredResumeId), [s.approved.id, s.pdf.id]);
  assert.equal(a.status, 'interview');
  // Stale revision.
  assert.equal((await s.a.put(`/api/applications/${a.id}/links`, { jobAnalysisId: s.analysis.id, tailoredResumeId: null, expectedRevision: 0 }).expect(409)).body.error.code, 'REVISION_CONFLICT');
});

test('the approved PDF is available through the existing owner-checked endpoints only', async () => {
  const s = await setup();
  const bob = await registerUser(app);
  const a = (await s.a.post('/api/applications', { tailoredResumeId: s.pdf.id }).expect(201)).body.data.application;
  assert.equal(a.links.tailoredResume.hasPdf, true);
  const pdf = await s.a.get(`/api/tailored-resumes/${a.tailoredResumeId}/pdf`).buffer(true).parse((r, cb) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  }).expect(200);
  const stored = await TailoredResume.findById(s.pdf.id).lean();
  assert.equal(crypto.createHash('sha256').update(pdf.body).digest('hex'), stored.pdf.fileHash);
  await request(app).get(`/api/tailored-resumes/${a.tailoredResumeId}/pdf`).set(auth(bob.token)).expect(404);
  await request(app).get(`/api/applications/${a.id}`).set(auth(bob.token)).expect(404);
});

test('linked analyses and versions cannot be deleted (also after unlinking); deleting the application keeps them', async () => {
  const s = await setup();
  let a = (await s.a.post('/api/applications', { tailoredResumeId: s.pdf.id }).expect(201)).body.data.application;
  assert.equal((await s.a.del(`/api/tailored-resumes/${s.pdf.id}`).expect(409)).body.error.code, 'LINKED_TO_APPLICATION');
  assert.equal(storage.deletes.length, 0, 'the PDF file must not be deleted either');
  // Analysis: blocked by its versions first (existing rule) …
  assert.equal((await s.a.del(`/api/job-analysis/${s.analysis.id}`).expect(409)).body.error.code, 'JOB_ANALYSIS_HAS_VERSIONS');
  // Unlinked, but still in the link history: still protected.
  a = (await s.a.put(`/api/applications/${a.id}/links`, { jobAnalysisId: null, tailoredResumeId: null, expectedRevision: a.revision }).expect(200)).body.data.application;
  assert.equal((await s.a.del(`/api/tailored-resumes/${s.pdf.id}`).expect(409)).body.error.code, 'LINKED_TO_APPLICATION');
  // Unlinked versions are deletable as before.
  await s.a.del(`/api/tailored-resumes/${s.draft.id}`).expect(200);
  // An analysis without versions but linked to an application is protected too.
  const lone = (await s.a.post('/api/job-analysis', { companyName: 'Contoso', jobTitle: 'Engineer', jobDescription: SECTIONED_JD }).expect(201)).body.data.jobAnalysis;
  await s.a.post('/api/applications', { jobAnalysisId: lone.id }).expect(201);
  assert.equal((await s.a.del(`/api/job-analysis/${lone.id}`).expect(409)).body.error.code, 'LINKED_TO_APPLICATION');
  // Deleting applications never deletes linked records.
  const beforeDelete = await counts();
  for (const app1 of (await s.a.get('/api/applications').expect(200)).body.data.items) await s.a.del(`/api/applications/${app1.id}`).expect(200);
  assert.deepEqual(await counts(), beforeDelete);
  // … and once no application references them, the normal delete rules apply again.
  await s.a.del(`/api/tailored-resumes/${s.pdf.id}`).expect(200);
  await s.a.del(`/api/job-analysis/${lone.id}`).expect(200);
});

test('another user’s links never block or reveal anything', async () => {
  const s = await setup();
  const other = await setup();
  await other.a.post('/api/applications', { tailoredResumeId: other.pdf.id }).expect(201);
  await s.a.del(`/api/tailored-resumes/${s.draft.id}`).expect(200); // not linked by s
  const a = (await s.a.post('/api/applications', { companyName: 'C', jobTitle: 'T' }).expect(201)).body.data.application;
  await other.a.put(`/api/applications/${a.id}/links`, { jobAnalysisId: other.analysis.id, tailoredResumeId: null, expectedRevision: 0 }).expect(404);
});

test('stale links stay visible after the master resume is replaced', async () => {
  const s = await setup();
  const a = (await s.a.post('/api/applications', { tailoredResumeId: s.pdf.id }).expect(201)).body.data.application;
  const { sampleResume } = await import('./helpers/fixtures.js');
  const changed = structuredClone(sampleResume);
  changed.summary = changed.summary.replace('Works in Agile teams', 'Works in Agile/Scrum teams');
  await uploadPdf(app, s.token, await samplePdf(changed), { method: 'put' }).expect(200);
  const now = (await s.a.get(`/api/applications/${a.id}`).expect(200)).body.data.application;
  assert.equal(now.links.jobAnalysis.stale, true);
  assert.equal(now.links.tailoredResume.masterChanged, true);
  assert.equal(now.links.tailoredResume.hasPdf, true); // history and the generated PDF remain available
});
