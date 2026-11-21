// CHECKPOINT 6F (backend) — search, filters, sorting, pagination, Kanban board data, CSV export.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { startTestApp, stopTestApp, registerUser, auth } from './helpers/testApp.js';
import { csvCell } from '../services/job-application.service.js';

let app;
before(async () => ({ app } = await startTestApp()));
after(stopTestApp);

const ROWS = [
  { companyName: 'Northwind Labs', jobTitle: 'Senior Backend Engineer', location: 'Bengaluru', source: 'linkedin', applicationDate: '2026-11-03' },
  { companyName: 'contoso', jobTitle: 'Full Stack Developer', location: 'Remote', source: 'naukri', applicationDate: '2026-10-15' },
  { companyName: 'Fabrikam', jobTitle: 'Node.js Developer (C++ team)', location: 'Hyderabad', source: 'referral', applicationDate: '2026-09-01' },
  { companyName: 'Adatum', jobTitle: 'Backend Developer', location: 'Bengaluru, KA', source: 'linkedin', applicationDate: null },
];

async function seed() {
  const user = await registerUser(app);
  const created = [];
  for (const row of ROWS) created.push((await request(app).post('/api/applications').set(auth(user.token)).send(row).expect(201)).body.data.application);
  // Fabrikam → applied
  await request(app).post(`/api/applications/${created[2].id}/status`).set(auth(user.token)).send({ status: 'applied', expectedRevision: 0 }).expect(200);
  return { ...user, created };
}
const list = (token, qs) => request(app).get(`/api/applications?${qs}`).set(auth(token)).expect(200).then((r) => r.body.data);
const names = (page) => page.items.map((i) => i.companyName);

test('search by company or title (case-insensitive, regex characters are literal)', async () => {
  const s = await seed();
  assert.deepEqual(names(await list(s.token, 'q=NORTHWIND')), ['Northwind Labs']);
  assert.deepEqual(names(await list(s.token, 'q=backend&sort=companyName&order=asc')), ['Adatum', 'Northwind Labs']);
  assert.deepEqual(names(await list(s.token, `q=${encodeURIComponent('C++')}`)), ['Fabrikam']);
  assert.deepEqual(names(await list(s.token, `q=${encodeURIComponent('.*')}`)), []);
  assert.deepEqual(names(await list(s.token, `q=${encodeURIComponent('(')}`)), ['Fabrikam']);
});

test('filters: status (multi), location, source, application date range', async () => {
  const s = await seed();
  assert.deepEqual(names(await list(s.token, 'status=applied')), ['Fabrikam']);
  assert.equal((await list(s.token, 'status=saved,applied')).total, 4);
  assert.equal((await list(s.token, 'status=saved&status=applied')).total, 4);
  assert.deepEqual(names(await list(s.token, 'location=bengaluru&sort=companyName&order=asc')), ['Adatum', 'Northwind Labs']);
  assert.deepEqual(names(await list(s.token, 'source=naukri')), ['contoso']);
  assert.deepEqual(names(await list(s.token, 'from=2026-10-01&to=2026-10-31')), ['contoso']);
  assert.deepEqual(names(await list(s.token, 'from=2026-10-01&sort=applicationDate&order=desc')), ['Northwind Labs', 'contoso']);
  assert.equal((await request(app).get('/api/applications?from=2026-11-01&to=2026-10-01').set(auth(s.token)).expect(400)).body.error.code, 'VALIDATION_ERROR');
  await request(app).get('/api/applications?source=fax').set(auth(s.token)).expect(400);
});

test('sorting (case-insensitive company names) and stable pagination', async () => {
  const s = await seed();
  assert.deepEqual(names(await list(s.token, 'sort=companyName&order=asc')), ['Adatum', 'contoso', 'Fabrikam', 'Northwind Labs']);
  assert.deepEqual(names(await list(s.token, 'sort=companyName&order=desc')), ['Northwind Labs', 'Fabrikam', 'contoso', 'Adatum']);
  const p1 = await list(s.token, 'sort=companyName&order=asc&limit=3&page=1');
  const p2 = await list(s.token, 'sort=companyName&order=asc&limit=3&page=2');
  assert.deepEqual([...names(p1), ...names(p2)], ['Adatum', 'contoso', 'Fabrikam', 'Northwind Labs']);
  assert.deepEqual([p1.total, p1.totalPages], [4, 2]);
  // Out-of-range paging values fall back to safe defaults.
  assert.equal((await list(s.token, 'limit=5000&page=-3')).limit, 20);
});

test('board: grouped by status with allowed moves; scoped to the user', async () => {
  const s = await seed();
  const other = await registerUser(app);
  const board = (await request(app).get('/api/applications/board').set(auth(s.token)).expect(200)).body.data;
  assert.deepEqual(Object.keys(board.columns), ['saved', 'applied', 'interview', 'selected', 'rejected', 'withdrawn']);
  assert.deepEqual([board.columns.saved.length, board.columns.applied.length, board.total, board.truncated], [3, 1, 4, false]);
  assert.deepEqual(board.columns.applied[0].allowedStatuses, ['interview', 'rejected', 'withdrawn']);
  assert.equal(board.columns.saved[0].jobDescription, undefined);
  assert.equal((await request(app).get('/api/applications/board').set(auth(other.token)).expect(200)).body.data.total, 0);
});

test('CSV export: user-scoped, filtered, injection-safe, UTF-8, download headers', async () => {
  const s = await seed();
  const other = await registerUser(app);
  await request(app).post('/api/applications').set(auth(other.token)).send({ companyName: 'Secret Corp', jobTitle: 'Spy' }).expect(201);
  await request(app)
    .post('/api/applications')
    .set(auth(s.token))
    .send({ companyName: '=HYPERLINK("http://evil.example","x")', jobTitle: '+Engineer', notes: 'Line 1\nLine "2" — ₹ salary', salary: { min: 100, currency: 'INR' } })
    .expect(201);
  const res = await request(app).get('/api/applications/export.csv?sort=companyName&order=asc').set(auth(s.token)).expect(200);
  assert.match(res.headers['content-type'], /^text\/csv; charset=utf-8/);
  assert.match(res.headers['content-disposition'], /^attachment; filename="job-applications-\d{4}-\d{2}-\d{2}\.csv"$/);
  assert.equal(res.headers['cache-control'], 'private, no-store');
  const text = res.text;
  assert.equal(text.charCodeAt(0), 0xfeff);
  assert.ok(!text.includes('Secret Corp'), 'another user’s data must never be exported');
  assert.ok(text.includes(`"'=HYPERLINK(""http://evil.example"",""x"")"`), 'formula neutralised and quotes escaped');
  assert.ok(text.includes(`"'+Engineer"`));
  assert.ok(text.includes('"Line 1\nLine ""2"" — ₹ salary"'));
  const rows = text.slice(1).trim().split('\r\n');
  assert.ok(rows[0].startsWith('"Company","Job title","Status","Application date"'));
  assert.ok(!rows[0].includes('description'), 'job descriptions are not exported');
  // Filters apply to the export as well.
  const filtered = (await request(app).get('/api/applications/export.csv?status=applied').set(auth(s.token)).expect(200)).text;
  assert.equal(filtered.slice(1).trim().split('\r\n').length, 2);
  assert.ok(filtered.includes('"Fabrikam"'));
  await request(app).get('/api/applications/export.csv').expect(401);
  await request(app).get('/api/applications/export.csv?status=nope').set(auth(s.token)).expect(400);
});

test('csvCell neutralises every formula prefix', () => {
  for (const v of ['=1+1', '+1', '-1', '@SUM(A1)', '\tcmd', '\rcmd']) assert.ok(csvCell(v).startsWith(`"'`), JSON.stringify(v));
  assert.equal(csvCell('a "b"'), '"a ""b"""');
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell(42), '"42"');
});
