// CHECKPOINT 6A — job applications: model, validation, CRUD, list basics, user isolation.
// Real local MongoDB (throwaway db); no AI, no storage.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { startTestApp, stopTestApp, registerUser, auth } from './helpers/testApp.js';
import { JobApplication } from '../models/JobApplication.js';

let app;
before(async () => ({ app } = await startTestApp()));
after(stopTestApp);

const FULL = {
  companyName: '  Northwind   Labs ',
  jobTitle: 'Senior Backend Engineer',
  location: 'Remote (India)',
  employmentType: 'full_time',
  salary: { min: 1800000, max: 2400000, currency: 'inr', period: 'year' },
  experience: { minYears: 3, maxYears: 6, text: '3–6 years' },
  source: 'linkedin',
  sourceDetail: 'Job post',
  jobUrl: 'https://jobs.example.com/northwind/123',
  jobDescription: 'Build and run Node.js services.\r\n\r\n\r\nWork with MongoDB.',
  applicationDate: '2026-11-10',
  notes: 'Referred by a former colleague.',
};
const create = (token, body = FULL) => request(app).post('/api/applications').set(auth(token)).send(body);

test('every endpoint requires authentication', async () => {
  const id = '0123456789abcdef01234567';
  for (const [m, p] of [['post', '/api/applications'], ['get', '/api/applications'], ['get', `/api/applications/${id}`], ['patch', `/api/applications/${id}`], ['delete', `/api/applications/${id}`]]) {
    assert.equal((await request(app)[m](p).send({})).status, 401, `${m} ${p}`);
  }
});

test('create stores every field, cleaned; starts in Saved with a "created" history entry', async () => {
  const { token } = await registerUser(app);
  const a = (await create(token).expect(201)).body.data.application;
  assert.equal(a.companyName, 'Northwind Labs');
  assert.equal(a.jobDescription, 'Build and run Node.js services.\n\nWork with MongoDB.');
  assert.deepEqual(a.salary, { min: 1800000, max: 2400000, currency: 'INR', period: 'year' });
  assert.deepEqual(a.experience, { minYears: 3, maxYears: 6, text: '3–6 years' });
  assert.equal(a.applicationDate, '2026-11-10');
  assert.equal(a.status, 'saved');
  assert.equal(a.revision, 0);
  assert.deepEqual(a.statusHistory.map((e) => [e.from, e.to, e.kind]), [[null, 'saved', 'created']]);
  assert.equal(a.jobAnalysisId, null);
  assert.deepEqual([a.interviews, a.followUps, a.linkHistory], [[], [], []]);
});

test('creating directly as Applied sets today as the application date when none is given', async () => {
  const { token } = await registerUser(app);
  const a = (await create(token, { companyName: 'Contoso', jobTitle: 'Engineer', status: 'applied' }).expect(201)).body.data.application;
  assert.equal(a.status, 'applied');
  assert.equal(a.applicationDate, new Date().toISOString().slice(0, 10));
  // Other statuses cannot be used at creation.
  assert.equal((await create(token, { companyName: 'C', jobTitle: 'E', status: 'selected' }).expect(400)).body.error.code, 'VALIDATION_ERROR');
});

test('validation: required fields, URLs, dates, salary/experience ranges, enums, lengths, unknown fields', async () => {
  const { token } = await registerUser(app);
  const bad = async (body, path) => {
    const res = await create(token, { companyName: 'C', jobTitle: 'T', ...body }).expect(400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    if (path) assert.ok(res.body.error.details.some((d) => d.path === path), `${path}: ${JSON.stringify(res.body.error.details)}`);
    assert.ok(!JSON.stringify(res.body).includes('javascript:'), 'submitted values are never echoed');
  };
  assert.deepEqual((await create(token, {}).expect(400)).body.error.details.map((d) => d.path).sort(), ['companyName', 'jobTitle']);
  await bad({ companyName: '   ' }, 'companyName');
  await bad({ jobUrl: 'javascript:alert(1)' }, 'jobUrl');
  await bad({ jobUrl: 'ftp://example.com/x' }, 'jobUrl');
  await bad({ applicationDate: '2026-02-30' }, 'applicationDate');
  await bad({ applicationDate: '10/11/2026' }, 'applicationDate');
  await bad({ salary: { min: 10, max: 5 } }, 'salary.min');
  await bad({ salary: { min: -1 } }, 'salary.min');
  await bad({ salary: { currency: 'RUPEES' } }, 'salary.currency');
  await bad({ experience: { minYears: 8, maxYears: 2 } }, 'experience.minYears');
  await bad({ employmentType: 'gig' }, 'employmentType');
  await bad({ source: 'newspaper' }, 'source');
  await bad({ jobDescription: 'x'.repeat(20_001) }, 'jobDescription');
  await bad({ notes: 'x'.repeat(5001) }, 'notes');
  await bad({ userId: '0123456789abcdef01234567' });
  await bad({ revision: 5 });
  // Empty optional values are fine.
  await create(token, { companyName: 'C', jobTitle: 'T', jobUrl: '', applicationDate: null, salary: { min: null } }).expect(201);
});

test('update: partial changes, optimistic concurrency, status and links cannot be changed here', async () => {
  const { token } = await registerUser(app);
  const a = (await create(token).expect(201)).body.data.application;
  const patch = (body) => request(app).patch(`/api/applications/${a.id}`).set(auth(token)).send(body);
  const u = (await patch({ notes: 'Spoke to recruiter.', location: 'Bengaluru', expectedRevision: 0 }).expect(200)).body.data.application;
  assert.deepEqual([u.notes, u.location, u.companyName, u.revision], ['Spoke to recruiter.', 'Bengaluru', 'Northwind Labs', 1]);
  assert.equal((await patch({ notes: 'stale', expectedRevision: 0 }).expect(409)).body.error.code, 'REVISION_CONFLICT');
  await patch({ status: 'selected', expectedRevision: 1 }).expect(400);
  await patch({ jobAnalysisId: '0123456789abcdef01234567', expectedRevision: 1 }).expect(400);
  await patch({ expectedRevision: 1 }).expect(400); // nothing to update
  await patch({ notes: 'x' }).expect(400); // revision required
  await patch({ companyName: '', expectedRevision: 1 }).expect(400);
  assert.equal((await JobApplication.findById(a.id).lean()).notes, 'Spoke to recruiter.');
});

test('user isolation: another user gets 404 for read, update and delete; malformed ids are 404', async () => {
  const alice = await registerUser(app);
  const bob = await registerUser(app);
  const a = (await create(alice.token).expect(201)).body.data.application;
  await request(app).get(`/api/applications/${a.id}`).set(auth(bob.token)).expect(404);
  await request(app).patch(`/api/applications/${a.id}`).set(auth(bob.token)).send({ notes: 'x', expectedRevision: 0 }).expect(404);
  await request(app).delete(`/api/applications/${a.id}`).set(auth(bob.token)).expect(404);
  for (const id of ['abc', '0123456789abcdef0123456z', "' OR 1=1", '%24where']) {
    await request(app).get(`/api/applications/${encodeURIComponent(id)}`).set(auth(alice.token)).expect(404);
  }
  assert.equal((await request(app).get('/api/applications').set(auth(bob.token)).expect(200)).body.data.total, 0);
  assert.ok(await JobApplication.exists({ _id: a.id }));
});

test('delete removes only that application', async () => {
  const { token } = await registerUser(app);
  const a = (await create(token).expect(201)).body.data.application;
  const b = (await create(token).expect(201)).body.data.application;
  await request(app).delete(`/api/applications/${a.id}`).set(auth(token)).expect(200);
  await request(app).get(`/api/applications/${a.id}`).set(auth(token)).expect(404);
  await request(app).get(`/api/applications/${b.id}`).set(auth(token)).expect(200);
});

test('list: summaries only (no description/notes), newest first, paginated; bad filters are 400', async () => {
  const { token } = await registerUser(app);
  for (let i = 0; i < 3; i += 1) await create(token, { ...FULL, companyName: `Company ${i}` }).expect(201);
  const page = (await request(app).get('/api/applications?limit=2').set(auth(token)).expect(200)).body.data;
  assert.equal(page.total, 3);
  assert.equal(page.totalPages, 2);
  assert.deepEqual(page.items.map((i) => i.companyName), ['Company 2', 'Company 1']);
  assert.equal(page.items[0].jobDescription, undefined);
  assert.equal(page.items[0].notes, undefined);
  assert.equal((await request(app).get('/api/applications?status=hired').set(auth(token)).expect(400)).body.error.code, 'VALIDATION_ERROR');
  await request(app).get('/api/applications?from=2026-13-01').set(auth(token)).expect(400);
});
