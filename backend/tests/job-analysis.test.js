// API tests for /api/job-analysis: auth, validation, persistence, ownership, AI and DB failures.
// Real local MongoDB (throwaway database), fake storage, fake AI; all data is fictional.
import { test, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import request from 'supertest';
import { startTestApp, stopTestApp, registerUser, auth, uploadPdf } from './helpers/testApp.js';
import { samplePdf, sampleResume } from './helpers/fixtures.js';
import { aiAnswer } from './helpers/fakeAi.js';
import { JobAnalysis } from '../models/JobAnalysis.js';
import { MasterResume } from '../models/MasterResume.js';
import { aiError } from '../services/ai/ai-errors.js';
import { createAiLimiter } from '../middleware/rateLimiter.js';
import { createApp } from '../app.js';

let app;
let ai;
before(async () => ({ app, ai } = await startTestApp()));
after(stopTestApp);
beforeEach(() => ai.reset());

const jd = (name) => fs.readFileSync(new URL(`./fixtures/job-descriptions/${name}`, import.meta.url), 'utf8');
const body = (overrides = {}) => ({ companyName: 'Northwind Labs', jobTitle: 'Senior Backend Engineer', jobDescription: jd('sectioned.txt'), ...overrides });
const SECTIONED_ANSWER = aiAnswer({
  minYears: 5,
  quote: '5+ years of professional software development experience',
  requirements: [
    { term: 'Node.js', category: 'backend' },
    { term: 'TypeScript', category: 'language' },
    { term: 'MongoDB', category: 'database' },
    { term: 'Docker', category: 'devops' },
    { term: 'NestJS', category: 'backend', importance: 'preferred', classification: 'DIRECT_MATCH', evidenceIds: ['skills.2.2'] },
    { term: 'Kubernetes', category: 'devops', importance: 'preferred' },
  ],
  responsibilities: [{ text: 'Design, build and maintain scalable RESTful APIs in Node.js.', classification: 'EXPERIENCE_SUPPORTED', evidenceIds: ['exp.1.1'] }],
});

async function userWithResume() {
  const user = await registerUser(app);
  await uploadPdf(app, user.token, await samplePdf()).expect(201);
  return user;
}
const analyse = (token, payload = body()) => request(app).post('/api/job-analysis').set(auth(token)).send(payload);

test('all endpoints require authentication', async () => {
  for (const [method, path] of [['post', '/api/job-analysis'], ['get', '/api/job-analysis'], ['get', '/api/job-analysis/0123456789abcdef01234567'], ['delete', '/api/job-analysis/0123456789abcdef01234567']]) {
    const res = await request(app)[method](path).send(body());
    assert.equal(res.status, 401, `${method} ${path}`);
  }
  await request(app).get('/api/job-analysis').set(auth('not-a-token')).expect(401);
  assert.equal(ai.requests.length, 0);
});

test('analysis requires a master resume (and never calls the AI without one)', async () => {
  const { token } = await registerUser(app);
  const res = await analyse(token).expect(422);
  assert.equal(res.body.error.code, 'MASTER_RESUME_REQUIRED');
  assert.equal(ai.requests.length, 0);
});

test('input validation: required fields, length limits, unknown fields; values are not echoed', async () => {
  const { token } = await userWithResume();
  const cases = [
    [{ companyName: '' }, 'companyName'],
    [{ jobTitle: undefined }, 'jobTitle'],
    [{ jobDescription: 'Too short to analyse.' }, 'jobDescription'],
    [{ jobDescription: 'x'.repeat(20_001) }, 'jobDescription'],
    [{ jobDescription: `${'1234567890 '.repeat(20)}` }, 'jobDescription'], // no words
    [{ companyName: 'C'.repeat(121) }, 'companyName'],
    [{ salary: '100k' }, ''],
  ];
  for (const [overrides, path] of cases) {
    const res = await analyse(token, body(overrides)).expect(400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.ok(res.body.error.details.some((d) => d.path === path), JSON.stringify(res.body.error.details));
    assert.equal(JSON.stringify(res.body).includes('Northwind'), false);
  }
  assert.equal(ai.requests.length, 0);
});

test('valid analysis is computed, persisted in MongoDB and returned', async () => {
  const { token, user } = await userWithResume();
  ai.respondWith(SECTIONED_ANSWER);
  const res = await analyse(token, body({ companyName: '  Northwind   Labs ', jobDescription: `${jd('sectioned.txt')}\r\n\r\n\r\n\u0007` })).expect(201);
  const a = res.body.data.jobAnalysis;

  assert.equal(a.companyName, 'Northwind Labs'); // whitespace normalised
  assert.equal(a.analysisVersion, 'phase4-v1');
  assert.ok(!a.jobDescription.includes('\u0007') && !a.jobDescription.includes('\r'));
  const byKeyword = Object.fromEntries(a.matchAnalysis.requirements.map((r) => [r.keyword, r]));
  assert.equal(byKeyword['Node.js'].classification, 'DIRECT_MATCH');
  assert.equal(byKeyword.Docker.classification, 'DIRECT_MATCH');
  assert.equal(byKeyword.NestJS.classification, 'MISSING'); // AI said DIRECT; rules disagree (Express.js is not NestJS)
  assert.equal(byKeyword.Kubernetes.classification, 'MISSING');
  assert.deepEqual(a.keywordAnalysis.mustHave.map((k) => k.keyword), ['Node.js', 'TypeScript', 'MongoDB', 'Docker']);
  assert.deepEqual(a.keywordAnalysis.preferred.map((k) => k.keyword), ['NestJS', 'Kubernetes']);
  assert.equal(a.matchAnalysis.experience.classification, 'DIRECT_MATCH');
  assert.equal(a.matchPercentage, a.matchAnalysis.score.matchPercentage);
  assert.ok(a.matchPercentage > 0 && a.matchPercentage <= 100);
  assert.match(a.matchAnalysis.score.disclaimer, /not an ATS score/);

  const doc = await JobAnalysis.findById(a.id).lean();
  assert.equal(String(doc.userId), user.id);
  for (const field of ['companyName', 'jobTitle', 'jobDescription', 'jobAnalysis', 'keywordAnalysis', 'matchAnalysis', 'analysisVersion', 'createdAt', 'updatedAt']) assert.ok(doc[field], field);
  assert.equal(doc.ai.model, 'fake-model');
  assert.match(doc.sourceResume.fileHash, /^[a-f0-9]{64}$/);

  const fetched = await request(app).get(`/api/job-analysis/${a.id}`).set(auth(token)).expect(200);
  assert.deepEqual(fetched.body.data.jobAnalysis, a);
});

test('the master resume is read but never modified', async () => {
  const { token, user } = await userWithResume();
  const before = await MasterResume.findOne({ userId: user.id }).lean();
  ai.respondWith(SECTIONED_ANSWER);
  await analyse(token).expect(201);
  const afterDoc = await MasterResume.findOne({ userId: user.id }).lean();
  assert.deepEqual(afterDoc, before);
});

test('privacy: the AI request contains no personal details from the uploaded resume', async () => {
  const { token } = await userWithResume();
  ai.respondWith(SECTIONED_ANSWER);
  await analyse(token).expect(201);
  const sent = JSON.stringify(ai.requests[0]);
  const p = sampleResume.personalInfo;
  for (const value of [p.fullName, p.email, p.phone, p.linkedin, p.github, p.location, 'Example Corp', 'Example Institute']) assert.equal(sent.includes(value), false, value);
  assert.equal(sent.includes('%PDF'), false); // the PDF itself is never sent
});

test('different JD formats are accepted (sections, plain paragraph, markdown, long text)', async () => {
  const { token } = await userWithResume();
  const long = `${jd('sectioned.txt')}\n${'We value reliability, clear documentation and calm incident response. '.repeat(260)}`.slice(0, 19_900);
  for (const jobDescription of [jd('plain-paragraph.txt'), jd('synonyms-duplicates.md'), jd('unsupported-skills.txt'), long]) {
    ai.respondWith(aiAnswer({ requirements: [{ term: 'TypeScript', category: 'language' }] }));
    const res = await analyse(token, body({ jobDescription })).expect(201);
    assert.ok(res.body.data.jobAnalysis.matchAnalysis.score);
  }
});

test('multiple analyses: newest first, pagination, summaries only', async () => {
  const { token } = await userWithResume();
  ai.respondWith(SECTIONED_ANSWER);
  for (const company of ['First Co', 'Second Co', 'Third Co']) await analyse(token, body({ companyName: company })).expect(201);

  const page1 = await request(app).get('/api/job-analysis?limit=2').set(auth(token)).expect(200);
  assert.deepEqual(page1.body.data.items.map((i) => i.companyName), ['Third Co', 'Second Co']);
  assert.equal(page1.body.data.total, 3);
  assert.equal(page1.body.data.totalPages, 2);
  assert.equal('jobDescription' in page1.body.data.items[0], false);
  assert.equal(typeof page1.body.data.items[0].matchPercentage, 'number');
  const page2 = await request(app).get('/api/job-analysis?limit=2&page=2').set(auth(token)).expect(200);
  assert.deepEqual(page2.body.data.items.map((i) => i.companyName), ['First Co']);
  const bad = await request(app).get('/api/job-analysis?limit=999&page=-3').set(auth(token)).expect(200);
  assert.equal(bad.body.data.limit, 20); // invalid paging falls back to defaults
});

test('ownership: other users cannot list, read or delete an analysis; unknown ids are 404', async () => {
  const owner = await userWithResume();
  const other = await registerUser(app);
  ai.respondWith(SECTIONED_ANSWER);
  const { id } = (await analyse(owner.token).expect(201)).body.data.jobAnalysis;

  assert.equal((await request(app).get('/api/job-analysis').set(auth(other.token)).expect(200)).body.data.total, 0);
  assert.equal((await request(app).get(`/api/job-analysis/${id}`).set(auth(other.token)).expect(404)).body.error.code, 'JOB_ANALYSIS_NOT_FOUND');
  await request(app).delete(`/api/job-analysis/${id}`).set(auth(other.token)).expect(404);
  assert.ok(await JobAnalysis.exists({ _id: id }));
  await request(app).get('/api/job-analysis/not-an-object-id').set(auth(owner.token)).expect(404);
  await request(app).get('/api/job-analysis/0123456789abcdef01234567').set(auth(owner.token)).expect(404);
});

test('delete removes the analysis', async () => {
  const { token } = await userWithResume();
  ai.respondWith(SECTIONED_ANSWER);
  const { id } = (await analyse(token).expect(201)).body.data.jobAnalysis;
  await request(app).delete(`/api/job-analysis/${id}`).set(auth(token)).expect(200);
  assert.equal(await JobAnalysis.exists({ _id: id }), null);
  await request(app).get(`/api/job-analysis/${id}`).set(auth(token)).expect(404);
  await request(app).delete(`/api/job-analysis/${id}`).set(auth(token)).expect(404);
});

test('AI failures map to clear errors and save nothing', async () => {
  const { token, user } = await userWithResume();
  const cases = [
    ['RATE_LIMITED', 429, 'AI_RATE_LIMITED'],
    ['UNAVAILABLE', 503, 'AI_UNAVAILABLE'],
    ['TIMEOUT', 504, 'AI_TIMEOUT'],
    ['INVALID_RESPONSE', 502, 'AI_INVALID_RESPONSE'],
    ['MODEL_UNAVAILABLE', 503, 'AI_MODEL_UNAVAILABLE'],
    ['BLOCKED', 422, 'AI_BLOCKED'],
  ];
  for (const [kind, status, code] of cases) {
    ai.respondWith(aiError(kind));
    const res = await analyse(token).expect(status);
    assert.equal(res.body.error.code, code);
  }
  assert.equal(await JobAnalysis.countDocuments({ userId: user.id }), 0);
});

test('an AI answer that breaks the schema is rejected without saving', async () => {
  const { token, user } = await userWithResume();
  ai.respondWith(() => {
    const broken = structuredClone(SECTIONED_ANSWER);
    broken.requirements[0].classification = 'PROBABLY';
    return broken;
  });
  const res = await analyse(token).expect(502);
  assert.equal(res.body.error.code, 'AI_INVALID_RESPONSE');
  assert.equal(await JobAnalysis.countDocuments({ userId: user.id }), 0);
});

test('AI not configured on the server: 503 AI_NOT_CONFIGURED', async () => {
  const { token } = await userWithResume();
  const unconfigured = createApp({ storage: app.locals.storage, ai: { isConfigured: false, generateJson: async () => assert.fail('must not be called') } });
  const res = await request(unconfigured).post('/api/job-analysis').set(auth(token)).send(body()).expect(503);
  assert.equal(res.body.error.code, 'AI_NOT_CONFIGURED');
  const health = await request(unconfigured).get('/api/health').expect(200);
  assert.equal(health.body.data.dependencies.ai, 'not_configured');
  assert.equal((await request(app).get('/api/health')).body.data.dependencies.ai, 'configured');
});

test('MongoDB failure while saving: 503 and nothing stored', async () => {
  const { token, user } = await userWithResume();
  ai.respondWith(SECTIONED_ANSWER);
  const failure = Object.assign(new Error('connection reset'), { name: 'MongoNetworkError' });
  const create = mock.method(JobAnalysis, 'create', async () => {
    throw failure;
  });
  try {
    const res = await analyse(token).expect(503);
    assert.equal(res.body.error.code, 'DATABASE_UNAVAILABLE');
  } finally {
    create.mock.restore();
  }
  assert.equal(await JobAnalysis.countDocuments({ userId: user.id }), 0);
});

test('per-user AI rate limiter returns 429 after the limit', async () => {
  const limited = express();
  limited.use((req, _res, next) => ((req.user = { id: req.get('x-user') }), next()));
  limited.post('/', createAiLimiter({ limit: 2, windowMs: 60_000, skip: () => false }), (_req, res) => res.json({ ok: true }));
  await request(limited).post('/').set('x-user', 'a').expect(200);
  await request(limited).post('/').set('x-user', 'a').expect(200);
  const res = await request(limited).post('/').set('x-user', 'a').expect(429);
  assert.equal(res.body.error.code, 'RATE_LIMITED');
  await request(limited).post('/').set('x-user', 'b').expect(200); // separate budget per user
});
