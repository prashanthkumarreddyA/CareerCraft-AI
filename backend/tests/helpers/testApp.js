// Shared test bootstrap: test env vars, a per-process MongoDB database (dropped afterwards),
// a fake storage provider, and small API helpers.
process.env.NODE_ENV = 'test';
process.env.CLIENT_URL = 'http://localhost:5180';
process.env.JWT_SECRET = 'test-secret-'.padEnd(64, 'x');
process.env.BCRYPT_ROUNDS = '4';

import mongoose from 'mongoose';
import request from 'supertest';
import { createFakeStorage } from './fakeStorage.js';
import { createFakeAi } from './fakeAi.js';

const { createApp } = await import('../../app.js');

export const TEST_MONGODB_URI = process.env.TEST_MONGODB_URI || `mongodb://127.0.0.1:27017/resume-builder-test-${process.pid}`;

export async function startTestApp({ ai = createFakeAi() } = {}) {
  if (!/test/i.test(TEST_MONGODB_URI)) throw new Error('Refusing to run tests against a database whose name does not contain "test"');
  await mongoose.connect(TEST_MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  await mongoose.connection.db.dropDatabase();
  const { User } = await import('../../models/User.js');
  const { MasterResume } = await import('../../models/MasterResume.js');
  const { JobAnalysis } = await import('../../models/JobAnalysis.js');
  const { TailoredResume } = await import('../../models/TailoredResume.js');
  const { JobApplication } = await import('../../models/JobApplication.js');
  await Promise.all([User.syncIndexes(), MasterResume.syncIndexes(), JobAnalysis.syncIndexes(), TailoredResume.syncIndexes(), JobApplication.syncIndexes()]);
  const storage = createFakeStorage();
  return { app: createApp({ storage, ai }), storage, ai };
}

export async function stopTestApp() {
  if (mongoose.connection.readyState === 1) await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
}

let counter = 0;
export async function registerUser(app, overrides = {}) {
  counter += 1;
  const body = { name: 'Test User', email: `user${counter}-${process.pid}@example.com`, password: 'correct-horse-battery', ...overrides };
  const res = await request(app).post('/api/auth/register').send(body).expect(201);
  return { token: res.body.data.token, user: res.body.data.user, password: body.password };
}

export const auth = (token) => ({ Authorization: `Bearer ${token}` });

export function uploadPdf(app, token, buffer, { method = 'post', fileName = 'resume.pdf', contentType = 'application/pdf' } = {}) {
  const path = method === 'post' ? '/api/resumes/upload' : '/api/resumes/master';
  return request(app)[method](path).set(auth(token)).attach('resume', buffer, { filename: fileName, contentType });
}
