import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.CLIENT_URL = 'http://localhost:5173';
const { createApp } = await import('../app.js');
const app = createApp();

test('GET /api/health returns service status', async () => {
  const res = await request(app).get('/api/health').expect(200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.service, 'ai-resume-builder-api');
  assert.ok(['ok', 'degraded'].includes(res.body.data.status));
  assert.ok('database' in res.body.data.dependencies);
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('allowed origin receives CORS header', async () => {
  const res = await request(app).get('/api/health').set('Origin', 'http://localhost:5173').expect(200);
  assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:5173');
});

test('CORS preflight allows every method the API uses (incl. PATCH for review decisions)', async () => {
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    const res = await request(app)
      .options('/api/tailored-resumes/0123456789abcdef01234567/changes/summary')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', method)
      .set('Access-Control-Request-Headers', 'authorization,content-type');
    assert.equal(res.status, 204, method);
    assert.ok(res.headers['access-control-allow-methods'].split(',').includes(method), `${method} not allowed`);
  }
});

test('unknown origin is rejected', async () => {
  const res = await request(app).get('/api/health').set('Origin', 'https://evil.example').expect(403);
  assert.equal(res.body.error.code, 'CORS_ORIGIN_DENIED');
  assert.equal(res.headers['access-control-allow-origin'], undefined);
});

test('unknown route returns JSON 404', async () => {
  const res = await request(app).get('/api/does-not-exist').expect(404);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});

test('malformed JSON returns 400, not 500', async () => {
  const res = await request(app).post('/api/anything').set('Content-Type', 'application/json').send('{"broken":').expect(400);
  assert.equal(res.body.error.code, 'INVALID_JSON');
});

test('security headers are set and x-powered-by is hidden', async () => {
  const res = await request(app).get('/api/health');
  assert.equal(res.headers['x-powered-by'], undefined);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
});
