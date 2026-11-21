// CHECKPOINT 6B — status pipeline: controlled transitions, undo, permanent history, concurrency.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { startTestApp, stopTestApp, registerUser, auth } from './helpers/testApp.js';
import { JobApplication, TRANSITIONS, STATUSES } from '../models/JobApplication.js';

let app;
before(async () => ({ app } = await startTestApp()));
after(stopTestApp);

const create = async (token, body = {}) => (await request(app).post('/api/applications').set(auth(token)).send({ companyName: 'Contoso', jobTitle: 'Engineer', ...body }).expect(201)).body.data.application;
const move = (token, a, status, extra = {}) => request(app).post(`/api/applications/${a.id}/status`).set(auth(token)).send({ status, expectedRevision: a.revision, ...extra });
const undo = (token, a) => request(app).post(`/api/applications/${a.id}/status/undo`).set(auth(token)).send({ expectedRevision: a.revision });

test('the full transition table is enforced (every from → to pair)', async () => {
  const { token } = await registerUser(app);
  // Reach each status through allowed moves, then try every target.
  const pathTo = { saved: [], applied: ['applied'], interview: ['applied', 'interview'], selected: ['applied', 'interview', 'selected'], rejected: ['applied', 'rejected'], withdrawn: ['withdrawn'] };
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      let a = await create(token);
      for (const step of pathTo[from]) a = (await move(token, a, step).expect(200)).body.data.application;
      assert.equal(a.status, from);
      assert.deepEqual(a.allowedStatuses, TRANSITIONS[from]);
      const res = await move(token, a, to);
      if (TRANSITIONS[from].includes(to)) {
        assert.equal(res.status, 200, `${from} → ${to}`);
        assert.equal(res.body.data.application.status, to);
      } else {
        assert.equal(res.status, 422, `${from} → ${to} should be refused`);
        assert.equal(res.body.error.code, 'INVALID_STATUS_TRANSITION');
        assert.deepEqual(res.body.error.details.allowed, TRANSITIONS[from]);
      }
    }
  }
});

test('history is permanent and timestamped; notes are kept; applied date filled automatically', async () => {
  const { token } = await registerUser(app);
  let a = await create(token);
  assert.equal(a.applicationDate, null);
  a = (await move(token, a, 'applied', { note: 'Applied via careers page' }).expect(200)).body.data.application;
  assert.equal(a.applicationDate, new Date().toISOString().slice(0, 10));
  a = (await move(token, a, 'interview').expect(200)).body.data.application;
  a = (await move(token, a, 'rejected').expect(200)).body.data.application;
  assert.deepEqual(a.statusHistory.map((e) => [e.from, e.to, e.kind]), [[null, 'saved', 'created'], ['saved', 'applied', 'change'], ['applied', 'interview', 'change'], ['interview', 'rejected', 'change']]);
  assert.equal(a.statusHistory[1].note, 'Applied via careers page');
  assert.ok(a.statusHistory.every((e) => !Number.isNaN(Date.parse(e.at))));
  // Final status: no further moves.
  assert.equal((await move(token, a, 'applied').expect(422)).body.error.code, 'INVALID_STATUS_TRANSITION');
  // A user-set application date is never overwritten.
  let b = await create(token, { applicationDate: '2026-10-01' });
  b = (await move(token, b, 'applied').expect(200)).body.data.application;
  assert.equal(b.applicationDate, '2026-10-01');
});

test('application date uses the user’s time zone', async () => {
  const { token } = await registerUser(app);
  const a = await create(token);
  const res = await request(app).post(`/api/applications/${a.id}/status?tz=Pacific/Kiritimati`).set(auth(token)).send({ status: 'applied', expectedRevision: 0 }).expect(200);
  const expected = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Kiritimati' }).format(new Date());
  assert.equal(res.body.data.application.applicationDate, expected);
  // An invalid time zone falls back to UTC rather than failing.
  const b = await create(token);
  await request(app).post(`/api/applications/${b.id}/status?tz=Mars/Base`).set(auth(token)).send({ status: 'applied', expectedRevision: 0 }).expect(200);
});

test('undo reverts the latest change (also out of a final status), is recorded, and cannot be chained', async () => {
  const { token } = await registerUser(app);
  let a = await create(token);
  a = (await move(token, a, 'applied').expect(200)).body.data.application;
  a = (await move(token, a, 'rejected').expect(200)).body.data.application;
  assert.equal(a.canUndo, true);
  a = (await undo(token, a).expect(200)).body.data.application;
  assert.equal(a.status, 'applied');
  assert.equal(a.canUndo, false);
  assert.deepEqual(a.statusHistory.at(-1), { ...a.statusHistory.at(-1), from: 'rejected', to: 'applied', kind: 'undo' });
  assert.equal((await undo(token, a).expect(422)).body.error.code, 'NOTHING_TO_UNDO');
  // Undoing the move into Applied clears the date it filled in.
  let b = await create(token);
  b = (await move(token, b, 'applied').expect(200)).body.data.application;
  b = (await undo(token, b).expect(200)).body.data.application;
  assert.deepEqual([b.status, b.applicationDate], ['saved', null]);
  // … but keeps a date the user edited afterwards.
  let c = await create(token);
  c = (await move(token, c, 'applied').expect(200)).body.data.application;
  c = (await request(app).patch(`/api/applications/${c.id}`).set(auth(token)).send({ applicationDate: '2026-09-09', expectedRevision: c.revision }).expect(200)).body.data.application;
  c = (await undo(token, c).expect(200)).body.data.application;
  assert.deepEqual([c.status, c.applicationDate], ['saved', '2026-09-09']);
  // Nothing to undo on a new application.
  assert.equal((await undo(token, await create(token)).expect(422)).body.error.code, 'NOTHING_TO_UNDO');
  // History is never shortened.
  assert.equal((await JobApplication.findById(a.id).lean()).statusHistory.length, 4);
});

test('concurrency: a stale revision is refused; two simultaneous moves cannot both win', async () => {
  const { token } = await registerUser(app);
  const a = await create(token);
  const [r1, r2] = await Promise.all([move(token, a, 'applied'), move(token, a, 'withdrawn')]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
  const doc = await JobApplication.findById(a.id).lean();
  assert.equal(doc.statusHistory.length, 2);
  assert.equal(doc.revision, 1);
  assert.equal((await move(token, a, 'applied').expect(409)).body.error.code, 'REVISION_CONFLICT');
});

test('isolation and validation: other users 404; unknown status 400', async () => {
  const alice = await registerUser(app);
  const bob = await registerUser(app);
  const a = await create(alice.token);
  await move(bob.token, a, 'applied').expect(404);
  await undo(bob.token, a).expect(404);
  await move(alice.token, a, 'hired').expect(400);
  await request(app).post(`/api/applications/${a.id}/status`).set(auth(alice.token)).send({ status: 'applied' }).expect(400);
  assert.equal((await JobApplication.findById(a.id).lean()).status, 'saved');
});
