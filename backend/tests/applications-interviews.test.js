// CHECKPOINT 6D — interview rounds: add, edit, results, reschedule history, cancellation, limits.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { startTestApp, stopTestApp, registerUser, auth } from './helpers/testApp.js';
import { JobApplication, LIMITS } from '../models/JobApplication.js';

let app;
before(async () => ({ app } = await startTestApp()));
after(stopTestApp);

async function setup() {
  const user = await registerUser(app);
  const a = (await request(app).post('/api/applications').set(auth(user.token)).send({ companyName: 'Contoso', jobTitle: 'Engineer', status: 'applied' }).expect(201)).body.data.application;
  return { ...user, a };
}
const call = (token, method, path, body) => request(app)[method](path).set(auth(token)).send(body);
const add = (s, a, body) => call(s.token, 'post', `/api/applications/${a.id}/interviews`, { expectedRevision: a.revision, ...body });

test('multiple rounds: numbered in order, all fields stored, upcoming round surfaced', async () => {
  const s = await setup();
  let a = (await add(s, s.a, { roundType: 'phone_screen', scheduledAt: '2030-01-10T10:00:00+05:30', durationMinutes: 30, interviewer: 'Priya (Recruiter)', meetingLink: 'https://meet.example.com/abc', notes: 'Bring portfolio' }).expect(201)).body.data.application;
  a = (await add(s, a, { roundType: 'technical', scheduledAt: '2030-01-15T14:30:00Z' }).expect(201)).body.data.application;
  assert.deepEqual(a.interviews.map((i) => [i.round, i.roundType, i.status, i.result]), [[1, 'phone_screen', 'scheduled', 'pending'], [2, 'technical', 'scheduled', 'pending']]);
  const first = a.interviews[0];
  assert.equal(first.scheduledAt, '2030-01-10T04:30:00.000Z'); // stored as an exact moment
  assert.deepEqual([first.durationMinutes, first.interviewer, first.meetingLink, first.notes], [30, 'Priya (Recruiter)', 'https://meet.example.com/abc', 'Bring portfolio']);
  assert.equal(a.nextInterview.id, first.id);
  const list = (await request(app).get('/api/applications').set(auth(s.token)).expect(200)).body.data.items;
  assert.equal(list[0].nextInterview.round, 1);
});

test('validation: date-time with zone required, safe meeting links only, enums, unknown fields', async () => {
  const s = await setup();
  for (const body of [
    { roundType: 'technical' },
    { roundType: 'technical', scheduledAt: '2030-01-10 10:00' }, // no zone
    { roundType: 'technical', scheduledAt: '2030-01-10' },
    { roundType: 'technical', scheduledAt: '2030-01-10T10:00:00Z', meetingLink: 'javascript:alert(1)' },
    { roundType: 'coffee', scheduledAt: '2030-01-10T10:00:00Z' },
    { roundType: 'technical', scheduledAt: '2030-01-10T10:00:00Z', result: 'maybe' },
    { roundType: 'technical', scheduledAt: '2030-01-10T10:00:00Z', status: 'completed' },
    { roundType: 'technical', scheduledAt: '2030-01-10T10:00:00Z', durationMinutes: 1 },
  ]) {
    assert.equal((await add(s, s.a, body).expect(400)).body.error.code, 'VALIDATION_ERROR', JSON.stringify(body));
  }
  assert.equal((await JobApplication.findById(s.a.id).lean()).interviews.length, 0);
});

test('feedback and result: recording a result marks the round as held', async () => {
  const s = await setup();
  let a = (await add(s, s.a, { roundType: 'technical', scheduledAt: '2030-02-01T09:00:00Z' }).expect(201)).body.data.application;
  const iv = a.interviews[0];
  a = (await call(s.token, 'patch', `/api/applications/${a.id}/interviews/${iv.id}`, { feedback: 'Strong on Node.js; asked about queues.', result: 'passed', expectedRevision: a.revision }).expect(200)).body.data.application;
  assert.deepEqual([a.interviews[0].result, a.interviews[0].status, a.interviews[0].feedback], ['passed', 'completed', 'Strong on Node.js; asked about queues.']);
  // A held round cannot be rescheduled or cancelled.
  assert.equal((await call(s.token, 'post', `/api/applications/${a.id}/interviews/${iv.id}/reschedule`, { scheduledAt: '2030-02-02T09:00:00Z', expectedRevision: a.revision }).expect(422)).body.error.code, 'INTERVIEW_NOT_SCHEDULED');
  assert.equal((await call(s.token, 'post', `/api/applications/${a.id}/interviews/${iv.id}/cancel`, { expectedRevision: a.revision }).expect(422)).body.error.code, 'INTERVIEW_NOT_SCHEDULED');
  // Marking as held without a result.
  a = (await add(s, a, { roundType: 'hr', scheduledAt: '2030-02-05T09:00:00Z' }).expect(201)).body.data.application;
  a = (await call(s.token, 'patch', `/api/applications/${a.id}/interviews/${a.interviews[1].id}`, { completed: true, expectedRevision: a.revision }).expect(200)).body.data.application;
  assert.deepEqual([a.interviews[1].status, a.interviews[1].result], ['completed', 'pending']);
});

test('rescheduling keeps every previous time with its reason', async () => {
  const s = await setup();
  let a = (await add(s, s.a, { roundType: 'technical', scheduledAt: '2030-03-01T09:00:00Z' }).expect(201)).body.data.application;
  const id = a.interviews[0].id;
  const resched = (to, reason) => call(s.token, 'post', `/api/applications/${a.id}/interviews/${id}/reschedule`, { scheduledAt: to, reason, expectedRevision: a.revision });
  a = (await resched('2030-03-03T09:00:00Z', 'Interviewer unavailable').expect(200)).body.data.application;
  a = (await resched('2030-03-04T11:00:00Z', 'Clash with my exam').expect(200)).body.data.application;
  const iv = a.interviews[0];
  assert.equal(iv.scheduledAt, '2030-03-04T11:00:00.000Z');
  assert.deepEqual(iv.rescheduleHistory.map((r) => [r.from, r.to, r.reason]), [
    ['2030-03-01T09:00:00.000Z', '2030-03-03T09:00:00.000Z', 'Interviewer unavailable'],
    ['2030-03-03T09:00:00.000Z', '2030-03-04T11:00:00.000Z', 'Clash with my exam'],
  ]);
  assert.equal((await resched('2030-03-04T11:00:00Z').expect(422)).body.error.code, 'SAME_TIME');
});

test('cancellation keeps the round; only notes/feedback stay editable; history never deleted', async () => {
  const s = await setup();
  let a = (await add(s, s.a, { roundType: 'managerial', scheduledAt: '2030-04-01T09:00:00Z' }).expect(201)).body.data.application;
  const id = a.interviews[0].id;
  a = (await call(s.token, 'post', `/api/applications/${a.id}/interviews/${id}/cancel`, { reason: 'Position put on hold', expectedRevision: a.revision }).expect(200)).body.data.application;
  assert.deepEqual([a.interviews[0].status, a.interviews[0].cancelReason], ['cancelled', 'Position put on hold']);
  assert.ok(a.interviews[0].cancelledAt);
  assert.equal(a.nextInterview, null);
  assert.equal((await call(s.token, 'patch', `/api/applications/${a.id}/interviews/${id}`, { result: 'passed', expectedRevision: a.revision }).expect(422)).body.error.code, 'INTERVIEW_CANCELLED');
  a = (await call(s.token, 'patch', `/api/applications/${a.id}/interviews/${id}`, { notes: 'Recruiter will reach out in Q3.', expectedRevision: a.revision }).expect(200)).body.data.application;
  assert.equal(a.interviews[0].notes, 'Recruiter will reach out in Q3.');
  assert.equal((await call(s.token, 'post', `/api/applications/${a.id}/interviews/${id}/cancel`, { expectedRevision: a.revision }).expect(422)).body.error.code, 'INTERVIEW_NOT_SCHEDULED');
  // There is no endpoint to delete an interview round.
  await request(app).delete(`/api/applications/${a.id}/interviews/${id}`).set(auth(s.token)).expect(404);
  assert.equal((await JobApplication.findById(a.id).lean()).interviews.length, 1);
});

test('limits, unknown ids, stale revisions and other users', async () => {
  const s = await setup();
  const bob = await registerUser(app);
  await JobApplication.updateOne({ _id: s.a.id }, { $set: { interviews: Array.from({ length: LIMITS.interviews }, (_, i) => ({ round: i + 1, roundType: 'other', scheduledAt: new Date(), createdAt: new Date(), updatedAt: new Date() })) } });
  assert.equal((await add(s, s.a, { roundType: 'hr', scheduledAt: '2030-01-01T00:00:00Z' }).expect(422)).body.error.code, 'LIMIT_REACHED');
  const s2 = await setup();
  let a = (await add(s2, s2.a, { roundType: 'hr', scheduledAt: '2030-01-01T00:00:00Z' }).expect(201)).body.data.application;
  const id = a.interviews[0].id;
  assert.equal((await call(s2.token, 'patch', `/api/applications/${a.id}/interviews/0123456789abcdef01234567`, { notes: 'x', expectedRevision: a.revision }).expect(404)).body.error.code, 'INTERVIEW_NOT_FOUND');
  assert.equal((await call(s2.token, 'patch', `/api/applications/${a.id}/interviews/zzz`, { notes: 'x', expectedRevision: a.revision }).expect(404)).body.error.code, 'INTERVIEW_NOT_FOUND');
  assert.equal((await call(s2.token, 'patch', `/api/applications/${a.id}/interviews/${id}`, { notes: 'x', expectedRevision: 0 }).expect(409)).body.error.code, 'REVISION_CONFLICT');
  await call(bob.token, 'patch', `/api/applications/${a.id}/interviews/${id}`, { notes: 'x', expectedRevision: a.revision }).expect(404);
  await call(bob.token, 'post', `/api/applications/${a.id}/interviews/${id}/cancel`, { expectedRevision: a.revision }).expect(404);
  await add(bob, a, { roundType: 'hr', scheduledAt: '2030-01-01T00:00:00Z' }).expect(404);
  // An interview id from another application of the same user is not found here.
  const other = await setup();
  await call(s2.token, 'patch', `/api/applications/${a.id}/interviews/${other.a.id}`, { notes: 'x', expectedRevision: a.revision }).expect(404);
});
