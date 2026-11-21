// Runs without connecting to MongoDB: every DB-backed route must fail fast with 503.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-'.padEnd(64, 'x');
const { createApp } = await import('../app.js');
const { createFakeStorage } = await import('./helpers/fakeStorage.js');
const app = createApp({ storage: createFakeStorage() });

test('auth and resume routes return 503 DATABASE_UNAVAILABLE when MongoDB is down', async () => {
  const started = Date.now();
  for (const [method, path] of [['post', '/api/auth/login'], ['post', '/api/auth/register'], ['get', '/api/resumes/master'], ['post', '/api/resumes/upload']]) {
    const res = await request(app)[method](path).send({});
    assert.equal(res.status, 503, `${method} ${path}`);
    assert.equal(res.body.error.code, 'DATABASE_UNAVAILABLE');
  }
  assert.ok(Date.now() - started < 2000, 'should fail fast, not wait for Mongoose buffering');
});

test('health still answers and reports the database state', async () => {
  const res = await request(app).get('/api/health').expect(200);
  assert.ok(['not_configured', 'disconnected'].includes(res.body.data.dependencies.database));
});
