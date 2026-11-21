// CLIENT_URL parsing: CORS origins are scheme + host (+ port) only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOrigins } from '../config/env.js';

test('a Netlify URL with a path is reduced to its origin (the deployed misconfiguration)', () => {
  const r = parseOrigins('https://careercraft-ai-dash.netlify.app/login');
  assert.deepEqual(r.origins, ['https://careercraft-ai-dash.netlify.app']);
  assert.deepEqual(r.adjusted, ['https://careercraft-ai-dash.netlify.app']);
  assert.deepEqual(r.invalid, []);
});

test('trailing slashes, spaces, duplicates and several origins', () => {
  const r = parseOrigins(' https://a.netlify.app/ , https://a.netlify.app, http://localhost:5180 ,https://b.example.com/app/x?y=1#z ');
  assert.deepEqual(r.origins, ['https://a.netlify.app', 'http://localhost:5180', 'https://b.example.com']);
});

test('a correct origin is kept unchanged and not reported', () => {
  const r = parseOrigins('https://careercraft-ai-dash.netlify.app');
  assert.deepEqual(r, { origins: ['https://careercraft-ai-dash.netlify.app'], adjusted: [], invalid: [] });
});

test('invalid entries are dropped, never allowed', () => {
  const r = parseOrigins('careercraft-ai-dash.netlify.app, *, javascript:alert(1), ftp://x.example');
  assert.deepEqual(r.origins, []);
  assert.equal(r.invalid.length, 4);
  assert.deepEqual(parseOrigins('').origins, []);
});
