import { test, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import request from 'supertest';
import { startTestApp, stopTestApp, registerUser, auth, uploadPdf } from './helpers/testApp.js';
import { sampleResume, samplePdf, blankPdf, corruptedPdf, unstructuredPdf } from './helpers/fixtures.js';
import { MasterResume } from '../models/MasterResume.js';

let app;
let storage;
before(async () => ({ app, storage } = await startTestApp()));
after(stopTestApp);
beforeEach(() => storage.reset());

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

test('valid PDF upload stores the original privately and the extracted data in MongoDB', async () => {
  const { token, user } = await registerUser(app);
  const pdf = await samplePdf();
  const res = await uploadPdf(app, token, pdf, { fileName: 'Alex_Morgan_Resume.pdf' }).expect(201);

  const m = res.body.data.masterResume;
  assert.equal(m.originalFileName, 'Alex_Morgan_Resume.pdf');
  assert.equal(m.fileFormat, 'pdf');
  assert.equal(m.fileSize, pdf.length);
  assert.equal(m.fileHash, sha256(pdf));
  assert.equal(m.pageCount, 1);
  assert.equal(m.templateId, 'classic-v1');
  assert.deepEqual(m.structuredResumeData, sampleResume); // structured data accuracy
  assert.equal('cloudinaryPublicId' in m, false); // storage identifiers are not exposed
  assert.equal('lines' in m.extractedContent, false);

  const doc = await MasterResume.findOne({ userId: user.id }).lean();
  assert.ok(doc.cloudinaryPublicId.startsWith(`resumes/master/${user.id}/`));
  assert.ok(!doc.cloudinaryPublicId.includes('Alex')); // file name never used in storage paths
  assert.ok(storage.files.get(doc.cloudinaryPublicId).equals(pdf)); // stored bytes are the untouched original
  assert.ok(doc.extractedContent.lines.length > 20);
});

test('GET /master returns the resume; ?include=lines adds the line dump', async () => {
  const { token } = await registerUser(app);
  await uploadPdf(app, token, await samplePdf()).expect(201);
  const res = await request(app).get('/api/resumes/master').set(auth(token)).expect(200);
  assert.deepEqual(res.body.data.masterResume.structuredResumeData, sampleResume);
  const withLines = await request(app).get('/api/resumes/master?include=lines').set(auth(token)).expect(200);
  assert.ok(Array.isArray(withLines.body.data.masterResume.extractedContent.lines));
});

test('GET /master returns 404 before any upload', async () => {
  const { token } = await registerUser(app);
  const res = await request(app).get('/api/resumes/master').set(auth(token)).expect(404);
  assert.equal(res.body.error.code, 'MASTER_RESUME_NOT_FOUND');
});

test('preview stream returns the original bytes; download link is signed and short-lived', async () => {
  const { token } = await registerUser(app);
  const pdf = await samplePdf();
  await uploadPdf(app, token, pdf).expect(201);

  const file = await request(app).get('/api/resumes/master/file').set(auth(token)).buffer(true).parse((res, cb) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  }).expect(200);
  assert.equal(file.headers['content-type'], 'application/pdf');
  assert.equal(file.headers['cache-control'], 'private, no-store');
  assert.ok(file.body.equals(pdf));

  const link = await request(app).get('/api/resumes/master/download-url').set(auth(token)).expect(200);
  assert.match(link.body.data.url, /signature=/);
  const ttl = (new Date(link.body.data.expiresAt) - Date.now()) / 1000;
  assert.ok(ttl > 0 && ttl <= 300);
});

test('integrity check fails if stored bytes differ from the original', async () => {
  const { token } = await registerUser(app);
  await uploadPdf(app, token, await samplePdf()).expect(201);
  storage.corruptOnFetch = true;
  const res = await request(app).get('/api/resumes/master/file').set(auth(token)).expect(502);
  assert.equal(res.body.error.code, 'FILE_INTEGRITY_ERROR');
});

test('invalid uploads are rejected before anything is stored', async () => {
  const { token, user } = await registerUser(app);
  const uploadsBefore = storage.uploads.length;
  const cases = [
    [Buffer.from('plain text, not a pdf'), { fileName: 'notes.txt', contentType: 'text/plain' }, 415, 'UNSUPPORTED_FILE_TYPE'],
    [Buffer.from('plain text renamed'), { fileName: 'fake.pdf', contentType: 'application/pdf' }, 415, 'UNSUPPORTED_FILE_TYPE'],
    [corruptedPdf(), {}, 422, 'INVALID_PDF'],
    [await blankPdf(), {}, 422, 'NO_TEXT'],
    [await unstructuredPdf(), {}, 422, 'EXTRACTION_INVALID'],
    [Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(5 * 1024 * 1024 + 1)]), {}, 413, 'FILE_TOO_LARGE'],
  ];
  for (const [buffer, opts, status, code] of cases) {
    const res = await uploadPdf(app, token, buffer, opts);
    assert.equal(res.status, status, `${code}: got ${res.status} ${JSON.stringify(res.body)}`);
    assert.equal(res.body.error.code, code);
  }
  const missing = await request(app).post('/api/resumes/upload').set(auth(token)).expect(400);
  assert.equal(missing.body.error.code, 'FILE_REQUIRED');
  const wrongField = await request(app).post('/api/resumes/upload').set(auth(token)).attach('file', await samplePdf(), 'r.pdf').expect(400);
  assert.equal(wrongField.body.error.code, 'UNEXPECTED_FILE_FIELD');

  assert.equal(storage.uploads.length, uploadsBefore);
  assert.equal(await MasterResume.countDocuments({ userId: user.id }), 0);
});

test('duplicate upload is rejected with 409 and leaves one record', async () => {
  const { token, user } = await registerUser(app);
  await uploadPdf(app, token, await samplePdf()).expect(201);
  const uploadsBefore = storage.uploads.length;
  const res = await uploadPdf(app, token, await samplePdf()).expect(409);
  assert.equal(res.body.error.code, 'MASTER_RESUME_EXISTS');
  assert.equal(storage.uploads.length, uploadsBefore); // rejected before uploading
  assert.equal(await MasterResume.countDocuments({ userId: user.id }), 1);
});

test('concurrent duplicate uploads: unique index wins, loser cleans up its stored file', async () => {
  const { token, user } = await registerUser(app);
  const pdf = await samplePdf();
  const results = await Promise.all([uploadPdf(app, token, pdf), uploadPdf(app, token, pdf), uploadPdf(app, token, pdf)]);
  const statuses = results.map((r) => r.status).sort();
  assert.equal(statuses.filter((s) => s === 201).length, 1, `statuses: ${statuses}`);
  assert.ok(statuses.filter((s) => s !== 201).every((s) => s === 409));
  assert.equal(await MasterResume.countDocuments({ userId: user.id }), 1);
  const doc = await MasterResume.findOne({ userId: user.id });
  const userFiles = [...storage.files.keys()].filter((k) => k.includes(user.id));
  assert.deepEqual(userFiles, [doc.cloudinaryPublicId]); // no orphaned files
});

test('Cloudinary upload failure returns 502 and creates no record', async () => {
  const { token, user } = await registerUser(app);
  storage.failUpload = true;
  const res = await uploadPdf(app, token, await samplePdf()).expect(502);
  assert.equal(res.body.error.code, 'STORAGE_ERROR');
  assert.equal(await MasterResume.countDocuments({ userId: user.id }), 0);
});

test('MongoDB failure after the file is stored deletes the stored file again', async () => {
  const { token, user } = await registerUser(app);
  const dbError = Object.assign(new Error('connection reset'), { name: 'MongoNetworkError' });
  const createMock = mock.method(MasterResume, 'create', async () => {
    throw dbError;
  });
  try {
    const res = await uploadPdf(app, token, await samplePdf()).expect(503);
    assert.equal(res.body.error.code, 'DATABASE_UNAVAILABLE');
  } finally {
    createMock.mock.restore();
  }
  const uploaded = storage.uploads.at(-1);
  assert.ok(uploaded.includes(user.id));
  assert.ok(storage.deletes.includes(uploaded));
  assert.equal(storage.files.has(uploaded), false);
});

test('replacement swaps the file and data and keeps the old file as a private backup', async () => {
  const { token, user } = await registerUser(app);
  const first = (await uploadPdf(app, token, await samplePdf(), { fileName: 'v1.pdf' }).expect(201)).body.data.masterResume;
  const oldPublicId = (await MasterResume.findOne({ userId: user.id })).cloudinaryPublicId;

  const changed = structuredClone(sampleResume);
  changed.summary = 'Updated summary for the replacement upload with Node.js and React.js experience.';
  const pdf2 = await samplePdf(changed);
  const res = await uploadPdf(app, token, pdf2, { method: 'put', fileName: 'v2.pdf' }).expect(200);
  const second = res.body.data.masterResume;

  assert.equal(second.id, first.id); // same record, still one per user
  assert.equal(second.originalFileName, 'v2.pdf');
  assert.equal(second.fileHash, sha256(pdf2));
  assert.equal(second.structuredResumeData.summary, changed.summary);
  assert.ok(new Date(second.uploadedAt) >= new Date(first.uploadedAt));
  const doc = await MasterResume.findOne({ userId: user.id });
  assert.notEqual(doc.cloudinaryPublicId, oldPublicId);
  assert.ok(!storage.deletes.includes(oldPublicId), 'the previous PDF must not be deleted');
  assert.ok(storage.files.has(oldPublicId));
  assert.ok(storage.files.has(doc.cloudinaryPublicId));
  assert.equal(await MasterResume.countDocuments({ userId: user.id }), 1);

  // The backup is recorded (no storage id exposed) and downloadable by the owner only.
  assert.equal(doc.backups.length, 1);
  assert.equal(doc.backups[0].cloudinaryPublicId, oldPublicId);
  assert.equal(second.backups.length, 1);
  const backup = second.backups[0];
  assert.deepEqual(
    [backup.originalFileName, backup.fileHash, backup.fileSize, backup.pageCount],
    ['v1.pdf', first.fileHash, first.fileSize, first.pageCount],
  );
  assert.ok(backup.replacedAt && backup.uploadedAt);
  assert.ok(!JSON.stringify(res.body).includes(oldPublicId));
  const bytes = await request(app).get(`/api/resumes/master/backups/${backup.id}/file`).set(auth(token)).buffer(true).parse((r, cb) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  }).expect(200);
  assert.equal(sha256(bytes.body), first.fileHash);
  const link = (await request(app).get(`/api/resumes/master/backups/${backup.id}/download-url`).set(auth(token)).expect(200)).body.data;
  assert.ok(link.url);
  // Another user cannot reach it; unknown ids are 404.
  const other = await registerUser(app);
  await request(app).get(`/api/resumes/master/backups/${backup.id}/file`).set(auth(other.token)).expect(404);
  await request(app).get('/api/resumes/master/backups/0123456789abcdef01234567/file').set(auth(token)).expect(404);

  // A second replacement keeps both previous files.
  const third = (await uploadPdf(app, token, await samplePdf(), { method: 'put', fileName: 'v3.pdf' }).expect(200)).body.data.masterResume;
  assert.deepEqual(third.backups.map((b) => b.originalFileName), ['v1.pdf', 'v2.pdf']);

  // Deleting the master resume deletes the current file AND every backup.
  const ids = [(await MasterResume.findOne({ userId: user.id })).cloudinaryPublicId, oldPublicId, doc.cloudinaryPublicId];
  await request(app).delete('/api/resumes/master').set(auth(token)).expect(200);
  for (const id of ids) assert.ok(storage.deletes.includes(id), 'file not deleted');
  assert.equal(await MasterResume.countDocuments({ userId: user.id }), 0);
});

test('failed replacement keeps the previous resume intact', async () => {
  const { token, user } = await registerUser(app);
  const original = (await uploadPdf(app, token, await samplePdf()).expect(201)).body.data.masterResume;
  const before = await MasterResume.findOne({ userId: user.id }).lean();

  await uploadPdf(app, token, await blankPdf(), { method: 'put' }).expect(422); // invalid file
  storage.failUpload = true;
  await uploadPdf(app, token, await samplePdf(), { method: 'put' }).expect(502); // storage down

  const after = await MasterResume.findOne({ userId: user.id }).lean();
  assert.equal(after.cloudinaryPublicId, before.cloudinaryPublicId);
  assert.equal(after.fileHash, original.fileHash);
  assert.ok(storage.files.has(before.cloudinaryPublicId));
});

test('replace without an existing resume returns 404', async () => {
  const { token } = await registerUser(app);
  const res = await uploadPdf(app, token, await samplePdf(), { method: 'put' }).expect(404);
  assert.equal(res.body.error.code, 'MASTER_RESUME_NOT_FOUND');
});

test('deletion removes the stored file and the record; deleting again is 404', async () => {
  const { token, user } = await registerUser(app);
  await uploadPdf(app, token, await samplePdf()).expect(201);
  const { cloudinaryPublicId } = await MasterResume.findOne({ userId: user.id });
  await request(app).delete('/api/resumes/master').set(auth(token)).expect(200);
  assert.equal(await MasterResume.countDocuments({ userId: user.id }), 0);
  assert.equal(storage.files.has(cloudinaryPublicId), false);
  await request(app).delete('/api/resumes/master').set(auth(token)).expect(404);
  await request(app).get('/api/resumes/master').set(auth(token)).expect(404);
});

test('if Cloudinary deletion fails, the record is kept so the user can retry', async () => {
  const { token, user } = await registerUser(app);
  await uploadPdf(app, token, await samplePdf()).expect(201);
  storage.failDelete = true;
  await request(app).delete('/api/resumes/master').set(auth(token)).expect(502);
  assert.equal(await MasterResume.countDocuments({ userId: user.id }), 1);
  storage.failDelete = false;
  await request(app).delete('/api/resumes/master').set(auth(token)).expect(200);
});

test('unauthorized access: no token, bad token, and other users are all blocked', async () => {
  const alice = await registerUser(app);
  const bob = await registerUser(app);
  await uploadPdf(app, alice.token, await samplePdf()).expect(201);

  for (const [method, path] of [['get', '/api/resumes/master'], ['get', '/api/resumes/master/file'], ['get', '/api/resumes/master/download-url'], ['delete', '/api/resumes/master'], ['post', '/api/resumes/upload'], ['put', '/api/resumes/master']]) {
    await request(app)[method](path).expect(401);
    await request(app)[method](path).set(auth('garbage.token.value')).expect(401);
  }
  // Bob sees only his own (non-existent) master resume and cannot touch Alice's.
  await request(app).get('/api/resumes/master').set(auth(bob.token)).expect(404);
  await request(app).get('/api/resumes/master/file').set(auth(bob.token)).expect(404);
  await request(app).delete('/api/resumes/master').set(auth(bob.token)).expect(404);
  await request(app).get('/api/resumes/master').set(auth(alice.token)).expect(200);

  // A revoked session cannot upload.
  await request(app).post('/api/auth/logout').set(auth(alice.token)).expect(200);
  await uploadPdf(app, alice.token, await samplePdf(), { method: 'put' }).expect(401);
});
