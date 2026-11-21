import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { startTestApp, stopTestApp, registerUser, auth } from './helpers/testApp.js';

let app;
before(async () => ({ app } = await startTestApp()));
after(stopTestApp);

test('register returns a token and the public user (no password hash)', async () => {
  const res = await request(app).post('/api/auth/register').send({ name: 'Jane', email: 'Jane@Example.com', password: 'long-enough-pw' }).expect(201);
  assert.ok(res.body.data.token);
  assert.equal(res.body.data.user.email, 'jane@example.com');
  assert.equal(JSON.stringify(res.body).includes('passwordHash'), false);
});

test('duplicate email is rejected with 409', async () => {
  await request(app).post('/api/auth/register').send({ name: 'A', email: 'dup@example.com', password: 'long-enough-pw' }).expect(201);
  const res = await request(app).post('/api/auth/register').send({ name: 'B', email: 'DUP@example.com', password: 'long-enough-pw' }).expect(409);
  assert.equal(res.body.error.code, 'EMAIL_IN_USE');
});

test('validation errors list fields but never echo the submitted password', async () => {
  const res = await request(app).post('/api/auth/register').send({ name: '', email: 'bad', password: 'short7!' }).expect(400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  assert.deepEqual(res.body.error.details.map((d) => d.path).sort(), ['email', 'name', 'password']);
  assert.equal(JSON.stringify(res.body).includes('short7!'), false);
});

test('login succeeds with correct credentials and fails generically otherwise', async () => {
  const { user, password } = await registerUser(app);
  const ok = await request(app).post('/api/auth/login').send({ email: user.email, password }).expect(200);
  assert.ok(ok.body.data.token);
  const wrong = await request(app).post('/api/auth/login').send({ email: user.email, password: 'wrong-password' }).expect(401);
  const unknown = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'whatever-pw' }).expect(401);
  assert.equal(wrong.body.error.message, unknown.body.error.message); // no account enumeration
});

test('GET /me requires a valid token', async () => {
  const { token, user } = await registerUser(app);
  const me = await request(app).get('/api/auth/me').set(auth(token)).expect(200);
  assert.equal(me.body.data.user.email, user.email);
  assert.equal((await request(app).get('/api/auth/me').expect(401)).body.error.code, 'AUTH_REQUIRED');
  assert.equal((await request(app).get('/api/auth/me').set(auth('not-a-jwt')).expect(401)).body.error.code, 'INVALID_TOKEN');
  const forged = jwt.sign({ sub: user.id, tv: 0 }, 'some-other-secret');
  assert.equal((await request(app).get('/api/auth/me').set(auth(forged)).expect(401)).body.error.code, 'INVALID_TOKEN');
  const expired = jwt.sign({ sub: user.id, tv: 0, exp: Math.floor(Date.now() / 1000) - 10 }, process.env.JWT_SECRET);
  assert.equal((await request(app).get('/api/auth/me').set(auth(expired)).expect(401)).body.error.code, 'TOKEN_EXPIRED');
  const noneAlg = jwt.sign({ sub: user.id, tv: 0 }, '', { algorithm: 'none' });
  await request(app).get('/api/auth/me').set(auth(noneAlg)).expect(401);
});

test('logout revokes existing tokens', async () => {
  const { token } = await registerUser(app);
  await request(app).post('/api/auth/logout').set(auth(token)).expect(200);
  const res = await request(app).get('/api/auth/me').set(auth(token)).expect(401);
  assert.equal(res.body.error.code, 'SESSION_REVOKED');
});
