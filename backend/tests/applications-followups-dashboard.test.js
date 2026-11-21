// CHECKPOINT 6E — follow-ups (pending / completed / overdue, time zones) and dashboard figures.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { startTestApp, stopTestApp, registerUser, auth } from './helpers/testApp.js';
import { JobApplication, LIMITS } from '../models/JobApplication.js';
import { getDashboard, reachedStatuses, todayIn } from '../services/job-application.service.js';

let app;
before(async () => ({ app } = await startTestApp()));
after(stopTestApp);

const iso = (d) => d.toISOString().slice(0, 10);
const days = (n) => iso(new Date(Date.now() + n * 86_400_000));
async function setup() {
  const user = await registerUser(app);
  const a = (await request(app).post('/api/applications').set(auth(user.token)).send({ companyName: 'Contoso', jobTitle: 'Engineer' }).expect(201)).body.data.application;
  return { ...user, a };
}
const call = (token, method, path, body) => request(app)[method](path).set(auth(token)).send(body);

test('follow-ups: add, edit, complete, re-open, delete; overdue flagged', async () => {
  const s = await setup();
  let a = (await call(s.token, 'post', `/api/applications/${s.a.id}/follow-ups`, { dueDate: days(-2), note: 'Email recruiter', expectedRevision: 0 }).expect(201)).body.data.application;
  a = (await call(s.token, 'post', `/api/applications/${a.id}/follow-ups`, { dueDate: days(3), note: 'Check status', expectedRevision: a.revision }).expect(201)).body.data.application;
  assert.deepEqual(a.followUps.map((f) => [f.dueDate, f.status, f.overdue]), [[days(-2), 'pending', true], [days(3), 'pending', false]]);
  const [late, soon] = a.followUps;
  a = (await call(s.token, 'patch', `/api/applications/${a.id}/follow-ups/${late.id}`, { status: 'completed', expectedRevision: a.revision }).expect(200)).body.data.application;
  let f = a.followUps.find((x) => x.id === late.id);
  assert.deepEqual([f.status, f.overdue], ['completed', false]);
  assert.ok(f.completedAt);
  a = (await call(s.token, 'patch', `/api/applications/${a.id}/follow-ups/${late.id}`, { status: 'pending', dueDate: days(1), note: 'Email recruiter again', expectedRevision: a.revision }).expect(200)).body.data.application;
  f = a.followUps.find((x) => x.id === late.id);
  assert.deepEqual([f.status, f.completedAt, f.dueDate, f.note], ['pending', null, days(1), 'Email recruiter again']);
  a = (await call(s.token, 'delete', `/api/applications/${a.id}/follow-ups/${soon.id}`, { expectedRevision: a.revision }).expect(200)).body.data.application;
  assert.deepEqual(a.followUps.map((x) => x.id), [late.id]);
  // The list shows the next pending follow-up.
  const item = (await request(app).get('/api/applications').set(auth(s.token)).expect(200)).body.data.items[0];
  assert.equal(item.nextFollowUp.id, late.id);
  assert.equal(item.overdueFollowUps, 0);
});

test('follow-ups: validation, limits, unknown ids, other users', async () => {
  const s = await setup();
  const bob = await registerUser(app);
  for (const body of [{ expectedRevision: 0 }, { dueDate: '2026-02-30', expectedRevision: 0 }, { dueDate: days(1), note: 'x'.repeat(1001), expectedRevision: 0 }, { dueDate: days(1), status: 'completed', expectedRevision: 0 }]) {
    await call(s.token, 'post', `/api/applications/${s.a.id}/follow-ups`, body).expect(400);
  }
  await call(bob.token, 'post', `/api/applications/${s.a.id}/follow-ups`, { dueDate: days(1), expectedRevision: 0 }).expect(404);
  assert.equal((await call(s.token, 'patch', `/api/applications/${s.a.id}/follow-ups/0123456789abcdef01234567`, { note: 'x', expectedRevision: 0 }).expect(404)).body.error.code, 'FOLLOW_UP_NOT_FOUND');
  await JobApplication.updateOne({ _id: s.a.id }, { $set: { followUps: Array.from({ length: LIMITS.followUps }, () => ({ dueDate: new Date(), createdAt: new Date() })) } });
  assert.equal((await call(s.token, 'post', `/api/applications/${s.a.id}/follow-ups`, { dueDate: days(1), expectedRevision: 0 }).expect(422)).body.error.code, 'LIMIT_REACHED');
});

test('overdue uses the user’s calendar day (time zone)', async () => {
  const s = await setup();
  // 2026-05-10 20:00 UTC is already 2026-05-11 in Kolkata (+05:30) but still 05-10 in New York.
  const now = new Date('2026-05-10T20:00:00Z');
  assert.equal(iso(todayIn('Asia/Kolkata', now)), '2026-05-11');
  assert.equal(iso(todayIn('America/New_York', now)), '2026-05-10');
  await JobApplication.updateOne({ _id: s.a.id }, { $push: { followUps: { dueDate: new Date('2026-05-10T00:00:00Z'), note: 'n', createdAt: now } } });
  const kolkata = await getDashboard(s.user.id, { tz: 'Asia/Kolkata', now });
  const ny = await getDashboard(s.user.id, { tz: 'America/New_York', now });
  assert.equal(kolkata.followUps.overdue.length, 1);
  assert.equal(ny.followUps.overdue.length, 0);
  assert.equal(ny.followUps.upcoming.length, 1);
});

test('reached statuses replay history with undo', () => {
  const h = (...evts) => evts.map(([to, kind = 'change']) => ({ to, kind }));
  assert.deepEqual([...reachedStatuses(h(['saved', 'created'], ['applied'], ['interview'], ['rejected']))], ['saved', 'applied', 'interview', 'rejected']);
  assert.deepEqual([...reachedStatuses(h(['saved', 'created'], ['applied'], ['interview'], ['applied', 'undo']))], ['saved', 'applied']);
});

test('dashboard figures with a fixed clock: totals, statuses, rates, trends, recent, follow-ups, interviews', async () => {
  const user = await registerUser(app);
  const now = new Date('2026-11-18T12:00:00Z'); // Wednesday
  const ev = (to, kind = 'change') => ({ from: null, to, kind, at: now });
  const make = (status, history, extra = {}) => ({ userId: user.user.id, companyName: `Co ${status}`, jobTitle: 'Engineer', status, statusHistory: history, createdAt: now, ...extra });
  await JobApplication.create([
    make('saved', [ev('saved', 'created')]),
    make('applied', [ev('saved', 'created'), ev('applied')], { applicationDate: new Date('2026-11-17T00:00:00Z') }), // this week
    make('interview', [ev('saved', 'created'), ev('applied'), ev('interview')], {
      applicationDate: new Date('2026-11-10T00:00:00Z'), // last week
      interviews: [
        { round: 1, roundType: 'technical', scheduledAt: new Date('2026-11-20T10:00:00Z'), status: 'scheduled', createdAt: now, updatedAt: now },
        { round: 2, roundType: 'hr', scheduledAt: new Date('2026-11-25T10:00:00Z'), status: 'cancelled', createdAt: now, updatedAt: now },
      ],
      followUps: [{ dueDate: new Date('2026-11-15T00:00:00Z'), createdAt: now }, { dueDate: new Date('2026-11-25T00:00:00Z'), createdAt: now }, { dueDate: new Date('2027-01-30T00:00:00Z'), createdAt: now }, { dueDate: new Date('2026-11-01T00:00:00Z'), status: 'completed', completedAt: now, createdAt: now }],
    }),
    make('selected', [ev('saved', 'created'), ev('applied'), ev('interview'), ev('selected')], { applicationDate: new Date('2026-10-05T00:00:00Z') }), // last month
    make('rejected', [ev('applied', 'created'), ev('rejected')], { applicationDate: new Date('2026-11-17T00:00:00Z') }),
    make('withdrawn', [ev('saved', 'created'), ev('applied'), ev('interview'), ev('withdrawn')], { applicationDate: new Date('2025-01-01T00:00:00Z') }), // outside the windows
    // Moved to interview by mistake and undone: counts as applied only.
    make('applied', [ev('saved', 'created'), ev('applied'), ev('interview'), ev('applied', 'undo')], { applicationDate: new Date('2026-11-18T00:00:00Z') }),
  ]);
  const d = await getDashboard(user.user.id, { tz: 'UTC', now });
  assert.equal(d.totals.applications, 7);
  assert.deepEqual(d.totals.byStatus, { saved: 1, applied: 2, interview: 1, selected: 1, rejected: 1, withdrawn: 1 });
  assert.equal(d.totals.offers, 1);
  assert.equal(d.totals.interviewsScheduled, 1); // the cancelled round does not count
  assert.deepEqual([d.totals.reachedApplied, d.totals.reachedInterview, d.totals.reachedSelected], [6, 3, 1]);
  assert.deepEqual(d.rates, { interviewConversion: 50, selectionRate: 33.3, offerRate: 16.7 });
  assert.equal(d.trends.weekly.length, 12);
  assert.deepEqual(d.trends.weekly.slice(-2), [{ start: '2026-11-09', count: 1 }, { start: '2026-11-16', count: 3 }]);
  assert.equal(d.trends.monthly.length, 12);
  assert.deepEqual(d.trends.monthly.slice(-2), [{ month: '2026-10', count: 1 }, { month: '2026-11', count: 4 }]);
  assert.equal(d.trends.monthly[0].month, '2025-12');
  assert.equal(d.recentApplications.length, 5);
  assert.deepEqual(d.followUps.overdue.map((f) => f.followUp.dueDate), ['2026-11-15']);
  assert.deepEqual(d.followUps.upcoming.map((f) => f.followUp.dueDate), ['2026-11-25']); // within 14 days
  assert.equal(d.followUps.pendingTotal, 3);
  assert.deepEqual(d.upcomingInterviews.map((i) => [i.companyName, i.interview.round]), [['Co interview', 1]]);
});

test('dashboard endpoint: scoped to the user, empty state, invalid time zone falls back to UTC', async () => {
  const fresh = await registerUser(app);
  const d = (await request(app).get('/api/applications/dashboard?tz=Not/AZone').set(auth(fresh.token)).expect(200)).body.data.dashboard;
  assert.equal(d.timeZone, 'UTC');
  assert.equal(d.totals.applications, 0);
  assert.deepEqual(d.rates, { interviewConversion: null, selectionRate: null, offerRate: null });
  assert.ok(d.trends.weekly.every((w) => w.count === 0));
  await request(app).get('/api/applications/dashboard').expect(401);
  // Another user's applications never appear.
  const s = await setup();
  const other = (await request(app).get('/api/applications/dashboard?tz=Asia/Kolkata').set(auth(fresh.token)).expect(200)).body.data.dashboard;
  assert.equal(other.totals.applications, 0);
  assert.equal((await request(app).get('/api/applications/dashboard').set(auth(s.token)).expect(200)).body.data.dashboard.totals.applications, 1);
});
