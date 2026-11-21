// CHECKPOINT 2 — approval workflow: versions, decisions, user edits + overrides, approval gate,
// version history, ownership and failures. Real local MongoDB (throwaway db), fake AI + storage.
import { test, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { startTestApp, stopTestApp, registerUser, auth, uploadPdf } from './helpers/testApp.js';
import { samplePdf, sampleResume } from './helpers/fixtures.js';
import { SECTIONED_ANALYSIS_ANSWER, SECTIONED_JD, tailoringAnswer } from './helpers/tailoringFixtures.js';
import { MasterResume } from '../models/MasterResume.js';
import { JobAnalysis } from '../models/JobAnalysis.js';
import { TailoredResume } from '../models/TailoredResume.js';
import { aiError } from '../services/ai/ai-errors.js';

let app;
let ai;
before(async () => ({ app, ai } = await startTestApp()));
after(stopTestApp);

// Route the fake AI by task: analysis, tailoring, and the repair round.
const REPAIR = { summary: null, bullets: [{ id: 'exp.1.2', text: 'Implemented background job processing on Redis queues, handling 50,000+ records per run with retries.', evidenceIds: ['exp.1.2'], targetedKeywords: ['Redis'], rationale: 'Leads with Redis.' }] };
const router = (overrides = {}) => (req) => overrides[req.task] ?? { 'job-analysis': SECTIONED_ANALYSIS_ANSWER, tailoring: tailoringAnswer(), 'tailoring-repair': REPAIR }[req.task];
beforeEach(() => {
  ai.reset();
  ai.respondWith(router());
});

async function setup() {
  const user = await registerUser(app);
  await uploadPdf(app, user.token, await samplePdf()).expect(201);
  const analysis = (await request(app).post('/api/job-analysis').set(auth(user.token)).send({ companyName: 'Northwind Labs', jobTitle: 'Senior Backend Engineer', jobDescription: SECTIONED_JD }).expect(201)).body.data.jobAnalysis;
  return { ...user, analysisId: analysis.id };
}
const createVersion = (s) => request(app).post(`/api/job-analysis/${s.analysisId}/tailored-resumes`).set(auth(s.token));
const decide = (s, v, changeId, body) => request(app).patch(`/api/tailored-resumes/${v.id}/changes/${changeId}`).set(auth(s.token)).send({ expectedRevision: v.revision, ...body });
const approve = (s, v) => request(app).post(`/api/tailored-resumes/${v.id}/approve`).set(auth(s.token)).send({ expectedRevision: v.revision });
const acceptAll = (s, v) => request(app).post(`/api/tailored-resumes/${v.id}/accept-all`).set(auth(s.token)).send({ expectedRevision: v.revision });

test('every endpoint requires authentication', async () => {
  const id = '0123456789abcdef01234567';
  for (const [m, p] of [['post', `/api/job-analysis/${id}/tailored-resumes`], ['get', `/api/job-analysis/${id}/tailored-resumes`], ['get', '/api/tailored-resumes'], ['get', `/api/tailored-resumes/${id}`], ['patch', `/api/tailored-resumes/${id}/changes/summary`], ['post', `/api/tailored-resumes/${id}/approve`], ['post', `/api/tailored-resumes/${id}/duplicate`], ['delete', `/api/tailored-resumes/${id}`], ['post', `/api/tailored-resumes/${id}/pdf`], ['get', `/api/tailored-resumes/${id}/pdf`]]) {
    assert.equal((await request(app)[m](p).send({})).status, 401, `${m} ${p}`);
  }
});

test('creating a version: proposals pending, blocked claims and gaps visible, master untouched', async () => {
  const s = await setup();
  const masterBefore = await MasterResume.findOne({ userId: s.user.id }).lean();
  const v = (await createVersion(s).expect(201)).body.data.tailoredResume;

  assert.equal(v.versionNumber, 1);
  assert.equal(v.status, 'draft');
  assert.ok(v.changes.length >= 4);
  assert.ok(v.changes.every((c) => c.decision === 'pending' && c.validation.passed));
  assert.deepEqual(v.blocked.map((b) => b.key), ['bullet-1-3']); // NestJS claim never offered
  assert.ok(v.gaps.some((g) => g.keyword === 'Kubernetes'));
  assert.deepEqual(v.content, sampleResume); // nothing applied until decided
  assert.equal(v.coverage.literalBefore, v.coverage.literalAfter);
  assert.equal(v.layout.passed, true);
  assert.deepEqual(await MasterResume.findOne({ userId: s.user.id }).lean(), masterBefore);

  const v2 = (await createVersion(s).expect(201)).body.data.tailoredResume;
  assert.equal(v2.versionNumber, 2);
  const list = (await request(app).get(`/api/job-analysis/${s.analysisId}/tailored-resumes`).set(auth(s.token)).expect(200)).body.data.items;
  assert.deepEqual(list.map((i) => i.versionNumber), [2, 1]);
  assert.equal((await request(app).get('/api/tailored-resumes').set(auth(s.token)).expect(200)).body.data.items.length, 2);
});

test('concurrent creation still yields unique version numbers', async () => {
  const s = await setup();
  const [a, b] = await Promise.all([createVersion(s), createVersion(s)]);
  assert.deepEqual([a.status, b.status], [201, 201]);
  assert.deepEqual([a.body.data.tailoredResume.versionNumber, b.body.data.tailoredResume.versionNumber].sort(), [1, 2]);
});

test('preconditions: unknown/foreign analysis 404, stale analysis 409, no master resume 422', async () => {
  const s = await setup();
  const other = await registerUser(app);
  await request(app).post(`/api/job-analysis/${s.analysisId}/tailored-resumes`).set(auth(other.token)).expect(404);
  await request(app).post('/api/job-analysis/not-an-id/tailored-resumes').set(auth(s.token)).expect(404);

  // Replace the master resume: the analysis evidence no longer matches.
  const changed = structuredClone(sampleResume);
  changed.summary = `${changed.summary} Enjoys mentoring.`;
  await uploadPdf(app, s.token, await samplePdf(changed), { method: 'put' }).expect(200);
  const stale = await createVersion(s).expect(409);
  assert.equal(stale.body.error.code, 'ANALYSIS_STALE');

  await request(app).delete('/api/resumes/master').set(auth(s.token)).expect(200);
  assert.equal((await createVersion(s).expect(422)).body.error.code, 'MASTER_RESUME_REQUIRED');
});

test('accept, reject and reset decisions update content and revision; stale revisions conflict', async () => {
  const s = await setup();
  let v = (await createVersion(s).expect(201)).body.data.tailoredResume;
  const summary = v.changes.find((c) => c.changeId === 'summary');

  v = (await decide(s, v, 'summary', { decision: 'accept' }).expect(200)).body.data.tailoredResume;
  assert.equal(v.content.summary, summary.proposed);
  assert.equal(v.revision, 1);
  assert.ok(v.coverage.literalAfter >= v.coverage.literalBefore);

  const conflict = await request(app).patch(`/api/tailored-resumes/${v.id}/changes/summary`).set(auth(s.token)).send({ decision: 'reject', expectedRevision: 0 }).expect(409);
  assert.equal(conflict.body.error.code, 'REVISION_CONFLICT');

  v = (await decide(s, v, 'summary', { decision: 'reject' }).expect(200)).body.data.tailoredResume;
  assert.equal(v.content.summary, sampleResume.summary);
  v = (await decide(s, v, 'summary', { decision: 'reset' }).expect(200)).body.data.tailoredResume;
  assert.equal(v.changes.find((c) => c.changeId === 'summary').decision, 'pending');
  assert.deepEqual(v.changes.find((c) => c.changeId === 'summary').history.map((h) => h.action), ['proposed', 'accepted', 'rejected', 'reset']);

  await decide(s, v, 'no-such-change', { decision: 'accept' }).expect(404);
  assert.equal((await decide(s, v, 'skills-order', { decision: 'edit', text: 'x' }).expect(400)).body.error.code, 'EDIT_NOT_ALLOWED');
  assert.equal((await decide(s, v, 'summary', { decision: 'promote' }).expect(400)).body.error.code, 'VALIDATION_ERROR');
});

test('user edits: supported edits save; unsupported edits need an explicit, audited override', async () => {
  const s = await setup();
  let v = (await createVersion(s).expect(201)).body.data.tailoredResume;
  const change = v.changes.find((c) => c.changeId === 'bullet-1-1');

  // Supported wording: saved as an edit without override.
  const fine = 'Built 30+ RESTful APIs with Node.js and Express.js for order processing and inventory synchronisation.';
  v = (await decide(s, v, 'bullet-1-1', { decision: 'edit', text: fine }).expect(200)).body.data.tailoredResume;
  let c = v.changes.find((x) => x.changeId === 'bullet-1-1');
  assert.equal(c.decision, 'edited');
  assert.equal(c.override, null);
  assert.equal(v.content.experience[0].bullets[0], fine);

  // A missing skill (NestJS) can never be added, even with an override.
  const gap = await decide(s, v, 'bullet-1-1', { decision: 'edit', text: 'Built 30+ RESTful APIs with NestJS for order processing and inventory synchronisation.', confirmOverride: true, confirmReview: true }).expect(422);
  assert.equal(gap.body.error.code, 'EDIT_INVALID');
  assert.deepEqual(gap.body.error.details.issues.map((i) => i.code), ['GAP_KEYWORD']);

  // Unsupported (40+ is a new number): rejected until confirmed; nothing saved.
  const risky = 'Built 40+ RESTful APIs with Node.js and Express.js for order processing and inventory synchronisation.';
  const refused = await decide(s, v, 'bullet-1-1', { decision: 'edit', text: risky }).expect(422);
  assert.equal(refused.body.error.code, 'CLAIM_CHECK_FAILED');
  assert.deepEqual(refused.body.error.details.issues.filter((i) => i.severity === 'error').map((i) => i.code).sort(), ['UNSUPPORTED_NUMBER']);
  assert.equal((await TailoredResume.findById(v.id).lean()).revision, v.revision);

  v = (await decide(s, v, 'bullet-1-1', { decision: 'edit', text: risky, confirmOverride: true }).expect(200)).body.data.tailoredResume;
  c = v.changes.find((x) => x.changeId === 'bullet-1-1');
  assert.equal(c.override.confirmed, true);
  assert.ok(c.override.confirmedAt);
  assert.deepEqual(c.override.issues.map((i) => i.code).sort(), ['UNSUPPORTED_NUMBER']);
  const audit = c.history.at(-1);
  assert.equal(audit.action, 'edited_with_override');
  assert.equal(audit.originalText, change.original);
  assert.equal(audit.proposedText, change.proposed);
  assert.equal(audit.editedText, risky);
  assert.equal(audit.overrideConfirmed, true);
  assert.equal(v.progress.overrides, 1);

  // Problems that would break the document cannot be overridden.
  const hard = await decide(s, v, 'bullet-1-1', { decision: 'edit', text: 'Built APIs ✓', confirmOverride: true }).expect(422);
  assert.equal(hard.body.error.code, 'EDIT_INVALID');
  assert.equal((await decide(s, v, 'bullet-1-1', { decision: 'edit', text: 'x'.repeat(500), confirmOverride: true }).expect(422)).body.error.code, 'EDIT_INVALID');
});

test('approval gate: blocked while decisions are pending; approved content is frozen and hashed', async () => {
  const s = await setup();
  let v = (await createVersion(s).expect(201)).body.data.tailoredResume;
  const blocked = await approve(s, v).expect(422);
  assert.equal(blocked.body.error.code, 'APPROVAL_BLOCKED');
  assert.ok(blocked.body.error.details.problems.every((p) => p.code === 'DECISIONS_PENDING'));

  v = (await acceptAll(s, v).expect(200)).body.data.tailoredResume;
  assert.equal(v.progress.pending, 0);
  v = (await approve(s, v).expect(200)).body.data.tailoredResume;
  assert.equal(v.status, 'approved');
  assert.match(v.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(v.validationReport.lockedFieldsIntact, true);
  assert.equal(v.validationReport.problems.length, 0);
  assert.ok(v.validationReport.claims.every((c) => c.passed));

  // Frozen: no further decisions, bulk accepts or re-approval.
  assert.equal((await decide(s, v, 'summary', { decision: 'reject' }).expect(409)).body.error.code, 'VERSION_LOCKED');
  assert.equal((await acceptAll(s, v).expect(409)).body.error.code, 'VERSION_LOCKED');
  assert.equal((await approve(s, v).expect(409)).body.error.code, 'VERSION_LOCKED');
  const stored = await TailoredResume.findById(v.id).lean();
  assert.deepEqual(stored.finalContent, v.content);
  assert.deepEqual(stored.baseContent, sampleResume); // the snapshot never changes
});

test('approval re-checks every claim: an unsupported edit that bypassed the API is blocked', async () => {
  const s = await setup();
  let v = (await createVersion(s).expect(201)).body.data.tailoredResume;
  v = (await acceptAll(s, v).expect(200)).body.data.tailoredResume;
  // Simulate a record altered outside the API: an edited bullet with no override.
  const doc = await TailoredResume.findById(v.id).lean();
  const changes = doc.changes.map((c) => (c.changeId === 'bullet-1-1' ? { ...c, decision: 'edited', editedText: 'Led a team of 12 engineers building Kubernetes platforms.', override: null } : c));
  await TailoredResume.updateOne({ _id: v.id }, { $set: { changes } });
  const res = await approve(s, v).expect(422);
  assert.ok(res.body.error.details.problems.some((p) => p.code === 'UNSUPPORTED_CLAIM'));
  assert.equal((await TailoredResume.findById(v.id).lean()).status, 'draft');
});

test('approval records overrides in the validation report', async () => {
  const s = await setup();
  let v = (await createVersion(s).expect(201)).body.data.tailoredResume;
  v = (await decide(s, v, 'bullet-1-1', { decision: 'edit', text: 'Built 40+ RESTful APIs with Node.js for order processing.', confirmOverride: true }).expect(200)).body.data.tailoredResume;
  v = (await acceptAll(s, v).expect(200)).body.data.tailoredResume;
  v = (await approve(s, v).expect(200)).body.data.tailoredResume;
  assert.equal(v.validationReport.overrides, 1);
  assert.equal(v.validationReport.claims.find((c) => c.changeId === 'bullet-1-1').overridden, true);
});

test('version history: duplicating an approved version creates a new draft with the same decisions', async () => {
  const s = await setup();
  let v1 = (await createVersion(s).expect(201)).body.data.tailoredResume;
  v1 = (await acceptAll(s, v1).expect(200)).body.data.tailoredResume;
  v1 = (await approve(s, v1).expect(200)).body.data.tailoredResume;

  const v2 = (await request(app).post(`/api/tailored-resumes/${v1.id}/duplicate`).set(auth(s.token)).expect(201)).body.data.tailoredResume;
  assert.equal(v2.versionNumber, 2);
  assert.equal(v2.status, 'draft');
  assert.deepEqual(v2.copiedFrom, { versionNumber: 1, id: v1.id });
  assert.deepEqual(v2.content, v1.content);
  assert.equal(v2.changes[0].history.at(-1).action, 'copied');
  const again = (await request(app).get(`/api/tailored-resumes/${v1.id}`).set(auth(s.token)).expect(200)).body.data.tailoredResume;
  assert.equal(again.status, 'approved'); // the original stays frozen
});

test('ownership: other users get 404 for every operation; ids that do not exist are 404', async () => {
  const s = await setup();
  const v = (await createVersion(s).expect(201)).body.data.tailoredResume;
  const other = await registerUser(app);
  const o = { ...other };
  await request(app).get(`/api/tailored-resumes/${v.id}`).set(auth(o.token)).expect(404);
  await decide(o, v, 'summary', { decision: 'accept' }).expect(404);
  await acceptAll(o, v).expect(404);
  await approve(o, v).expect(404);
  await request(app).post(`/api/tailored-resumes/${v.id}/duplicate`).set(auth(o.token)).expect(404);
  await request(app).delete(`/api/tailored-resumes/${v.id}`).set(auth(o.token)).expect(404);
  assert.equal((await request(app).get('/api/tailored-resumes').set(auth(o.token)).expect(200)).body.data.items.length, 0);
  await request(app).get('/api/tailored-resumes/xyz').set(auth(s.token)).expect(404);
  assert.ok(await TailoredResume.exists({ _id: v.id }));
});

test('deletion: versions are deletable; an analysis with versions cannot be deleted', async () => {
  const s = await setup();
  const v = (await createVersion(s).expect(201)).body.data.tailoredResume;
  assert.equal((await request(app).delete(`/api/job-analysis/${s.analysisId}`).set(auth(s.token)).expect(409)).body.error.code, 'JOB_ANALYSIS_HAS_VERSIONS');
  await request(app).delete(`/api/tailored-resumes/${v.id}`).set(auth(s.token)).expect(200);
  await request(app).get(`/api/tailored-resumes/${v.id}`).set(auth(s.token)).expect(404);
  await request(app).delete(`/api/job-analysis/${s.analysisId}`).set(auth(s.token)).expect(200);
});

test('failures: AI errors and database errors save nothing', async () => {
  const s = await setup();
  ai.respondWith(router({ tailoring: aiError('UNAVAILABLE') }));
  assert.equal((await createVersion(s).expect(503)).body.error.code, 'AI_UNAVAILABLE');
  ai.respondWith(router({ tailoring: { summary: 'bad', bullets: 'bad' } }));
  assert.equal((await createVersion(s).expect(502)).body.error.code, 'AI_INVALID_RESPONSE');

  ai.respondWith(router());
  const create = mock.method(TailoredResume, 'create', async () => {
    throw Object.assign(new Error('connection reset'), { name: 'MongoNetworkError' });
  });
  try {
    assert.equal((await createVersion(s).expect(503)).body.error.code, 'DATABASE_UNAVAILABLE');
  } finally {
    create.mock.restore();
  }
  assert.equal(await TailoredResume.countDocuments({ userId: s.user.id }), 0);
  assert.ok(await JobAnalysis.exists({ _id: s.analysisId }));
});

// ------------------------------------------------------------ meaning review + identity lock
const MEANING_ANSWER = tailoringAnswer({
  bullets: [{ id: 'exp.1.1', text: 'Optimized 30+ RESTful APIs in Node.js/Express.js for order processing and inventory synchronisation.', evidenceIds: ['exp.1.1'], targetedKeywords: ['RESTful APIs'], rationale: 'Emphasises performance.' }],
});

test('meaning changes need an explicit, recorded review: accept-all skips them, approval checks them', async () => {
  const s = await setup();
  ai.respondWith(router({ tailoring: MEANING_ANSWER }));
  let v = (await createVersion(s).expect(201)).body.data.tailoredResume;
  const flagged = v.changes.find((c) => c.changeId === 'bullet-1-1');
  assert.equal(flagged.validation.passed, true);
  assert.equal(flagged.validation.needsReview, true);
  assert.ok(flagged.validation.issues.some((i) => i.code === 'MEANING_CHANGED' && i.severity === 'review'));

  // Bulk acceptance never includes it.
  v = (await acceptAll(s, v).expect(200)).body.data.tailoredResume;
  assert.equal(v.changes.find((c) => c.changeId === 'bullet-1-1').decision, 'pending');
  assert.ok(v.changes.filter((c) => c.changeId !== 'bullet-1-1').every((c) => c.decision === 'accepted'));

  // Accepting it alone requires the confirmation.
  const refused = await decide(s, v, 'bullet-1-1', { decision: 'accept' }).expect(422);
  assert.equal(refused.body.error.code, 'REVIEW_REQUIRED');
  assert.ok(refused.body.error.details.issues.some((i) => i.code === 'MEANING_CHANGED'));
  v = (await decide(s, v, 'bullet-1-1', { decision: 'accept', confirmReview: true }).expect(200)).body.data.tailoredResume;
  const accepted = v.changes.find((c) => c.changeId === 'bullet-1-1');
  assert.equal(accepted.decision, 'accepted');
  assert.equal(accepted.review.confirmed, true);
  const entry = accepted.history.at(-1);
  assert.equal(entry.action, 'accepted_after_review');
  assert.equal(entry.reviewConfirmed, true);
  assert.equal(entry.proposedText, flagged.proposed);
  assert.equal(v.progress.reviewed, 1);

  // An accepted meaning change WITHOUT a recorded review (e.g. tampered data) blocks approval.
  const doc = await TailoredResume.findById(v.id).lean();
  const changes = doc.changes.map((c) => (c.changeId === 'bullet-1-1' ? { ...c, review: null } : c));
  await TailoredResume.updateOne({ _id: v.id }, { $set: { changes } });
  const blocked = await approve(s, v).expect(422);
  assert.equal(blocked.body.error.code, 'APPROVAL_BLOCKED');
  assert.ok(blocked.body.error.details.problems.some((p) => p.code === 'REVIEW_NOT_CONFIRMED'));

  // Restored confirmation → approval succeeds.
  await TailoredResume.updateOne({ _id: v.id }, { $set: { changes: doc.changes } });
  const approved = (await approve(s, v).expect(200)).body.data.tailoredResume;
  assert.equal(approved.status, 'approved');
});

test('the user’s own edit that changes the meaning needs confirmReview, and it is audited', async () => {
  const s = await setup();
  const v = (await createVersion(s).expect(201)).body.data.tailoredResume;
  const text = 'Optimized 30+ RESTful APIs in Node.js/Express.js for order processing and inventory synchronisation.';
  const refused = await decide(s, v, 'bullet-1-1', { decision: 'edit', text }).expect(422);
  assert.equal(refused.body.error.code, 'REVIEW_REQUIRED');
  const done = (await decide(s, v, 'bullet-1-1', { decision: 'edit', text, confirmReview: true }).expect(200)).body.data.tailoredResume;
  const change = done.changes.find((c) => c.changeId === 'bullet-1-1');
  assert.equal(change.decision, 'edited');
  assert.equal(change.review.confirmed, true);
  const entry = change.history.at(-1);
  assert.deepEqual([entry.action, entry.reviewConfirmed, entry.editedText, entry.originalText], ['edited', true, text, sampleResume.experience[0].bullets[0]]);
});

test('identity lock: no override can change “Full Stack Developer”; master resume is never modified', async () => {
  const s = await setup();
  const masterBefore = await MasterResume.findOne({ userId: s.user.id }).lean();
  // The AI's identity change is blocked, never offered.
  ai.respondWith(router({ tailoring: tailoringAnswer({ summary: { ...tailoringAnswer().summary, text: tailoringAnswer().summary.text.replace('Full Stack Developer', 'Backend Developer') } }), 'tailoring-repair': { summary: null, bullets: [] } }));
  const v = (await createVersion(s).expect(201)).body.data.tailoredResume;
  assert.ok(!v.changes.some((c) => c.changeId === 'summary'));
  assert.ok(v.blocked.find((b) => b.key === 'summary').issues.some((i) => i.code === 'IDENTITY_CHANGED'));

  // The user's own identity change cannot be overridden either (summary card via a version that has one).
  ai.respondWith(router());
  const v2 = (await createVersion(s).expect(201)).body.data.tailoredResume;
  const edited = sampleResume.summary.replace('Full Stack Developer', 'Backend Developer');
  const res = await decide(s, v2, 'summary', { decision: 'edit', text: edited, confirmOverride: true, confirmReview: true }).expect(422);
  assert.equal(res.body.error.code, 'EDIT_INVALID');
  assert.ok(res.body.error.details.issues.some((i) => i.code === 'IDENTITY_CHANGED'));
  const after = (await request(app).get(`/api/tailored-resumes/${v2.id}`).set(auth(s.token)).expect(200)).body.data.tailoredResume;
  assert.equal(after.changes.find((c) => c.changeId === 'summary').decision, 'pending');
  assert.equal(after.content.headline, sampleResume.headline);
  assert.deepEqual(await MasterResume.findOne({ userId: s.user.id }).lean(), masterBefore);
});

test('proposals stored under older rules are re-checked with the current rules on accept', async () => {
  const s = await setup();
  ai.respondWith(router({ tailoring: MEANING_ANSWER }));
  const v = (await createVersion(s).expect(201)).body.data.tailoredResume;
  // Simulate a version created before the meaning checker existed.
  const doc = await TailoredResume.findById(v.id).lean();
  const changes = doc.changes.map((c) => (c.changeId === 'bullet-1-1' ? { ...c, validation: { passed: true, issues: [] } } : c));
  await TailoredResume.updateOne({ _id: v.id }, { $set: { changes } });
  assert.equal((await decide(s, v, 'bullet-1-1', { decision: 'accept' }).expect(422)).body.error.code, 'REVIEW_REQUIRED');
  const shown = (await request(app).get(`/api/tailored-resumes/${v.id}`).set(auth(s.token)).expect(200)).body.data.tailoredResume;
  assert.equal(shown.changes.find((c) => c.changeId === 'bullet-1-1').validation.needsReview, true);
});

test('replacing the master resume makes old analyses and versions stale (approve/PDF/duplicate refused)', async () => {
  const s = await setup();
  let draft = (await createVersion(s).expect(201)).body.data.tailoredResume;
  let approved = (await createVersion(s).expect(201)).body.data.tailoredResume;
  approved = (await acceptAll(s, approved).expect(200)).body.data.tailoredResume;
  approved = (await approve(s, approved).expect(200)).body.data.tailoredResume;
  assert.equal((await request(app).get(`/api/job-analysis/${s.analysisId}`).set(auth(s.token)).expect(200)).body.data.jobAnalysis.stale, false);

  // Replace the master resume (NestJS-free fictional resume with a different summary).
  const changed = structuredClone(sampleResume);
  changed.summary = changed.summary.replace('Works in Agile teams', 'Works in Agile/Scrum teams');
  await uploadPdf(app, s.token, await samplePdf(changed), { method: 'put' }).expect(200);

  const old = (await request(app).get(`/api/job-analysis/${s.analysisId}`).set(auth(s.token)).expect(200)).body.data.jobAnalysis;
  assert.equal(old.stale, true);
  assert.equal((await request(app).get('/api/job-analysis').set(auth(s.token)).expect(200)).body.data.items.find((i) => i.id === s.analysisId).stale, true);
  assert.equal((await createVersion(s).expect(409)).body.error.code, 'ANALYSIS_STALE');

  draft = (await request(app).get(`/api/tailored-resumes/${draft.id}`).set(auth(s.token)).expect(200)).body.data.tailoredResume;
  assert.equal(draft.masterChanged, true);
  draft = (await acceptAll(s, draft).expect(200)).body.data.tailoredResume;
  assert.equal((await approve(s, draft).expect(409)).body.error.code, 'MASTER_CHANGED');
  assert.equal((await request(app).post(`/api/tailored-resumes/${approved.id}/pdf`).set(auth(s.token)).expect(409)).body.error.code, 'MASTER_CHANGED');
  assert.equal((await request(app).post(`/api/tailored-resumes/${approved.id}/duplicate`).set(auth(s.token)).expect(409)).body.error.code, 'MASTER_CHANGED');
  const list = (await request(app).get(`/api/job-analysis/${s.analysisId}/tailored-resumes`).set(auth(s.token)).expect(200)).body.data.items;
  assert.ok(list.every((v) => v.masterChanged === true));

  // A fresh analysis is current and can be tailored again.
  const fresh = (await request(app).post('/api/job-analysis').set(auth(s.token)).send({ companyName: 'Northwind Labs', jobTitle: 'Senior Backend Engineer', jobDescription: SECTIONED_JD }).expect(201)).body.data.jobAnalysis;
  assert.equal(fresh.stale, false);
  const v = (await request(app).post(`/api/job-analysis/${fresh.id}/tailored-resumes`).set(auth(s.token)).expect(201)).body.data.tailoredResume;
  assert.equal(v.masterChanged, false);
});
