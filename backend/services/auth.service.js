import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';

const JWT_ALGORITHM = 'HS256';
// Compared against when the email is unknown, so response time does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-real-password', 10);

function issueToken(user, tokenVersion) {
  const token = jwt.sign({ sub: String(user._id), tv: tokenVersion }, config.jwt.secret, {
    algorithm: JWT_ALGORITHM,
    expiresIn: config.jwt.expiresIn,
  });
  const { exp } = jwt.decode(token);
  return { token, expiresAt: new Date(exp * 1000).toISOString() };
}

export async function registerUser({ name, email, password }) {
  const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
  let user;
  try {
    user = await User.create({ name, email, passwordHash });
  } catch (err) {
    if (err?.code === 11000) throw ApiError.conflict('An account with this email already exists.', { code: 'EMAIL_IN_USE' });
    throw err;
  }
  return { user: user.toJSON(), ...issueToken(user, 0) };
}

export async function loginUser({ email, password }) {
  const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash +tokenVersion');
  const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !valid) throw ApiError.unauthorized('Invalid email or password.', { code: 'INVALID_CREDENTIALS' });
  return { user: user.toJSON(), ...issueToken(user, user.tokenVersion) };
}

/** Revokes every token issued to the user so far (stateless JWTs cannot be revoked individually). */
export async function logoutUser(userId) {
  await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
}

/** Verifies a bearer token and returns the current user, or throws 401. */
export async function authenticateToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, config.jwt.secret, { algorithms: [JWT_ALGORITHM] });
  } catch (err) {
    if (err.name === 'TokenExpiredError') throw ApiError.unauthorized('Your session has expired. Please sign in again.', { code: 'TOKEN_EXPIRED' });
    throw ApiError.unauthorized('Invalid session. Please sign in again.', { code: 'INVALID_TOKEN' });
  }
  const user = await User.findById(payload.sub).select('+tokenVersion');
  if (!user || user.tokenVersion !== payload.tv) {
    throw ApiError.unauthorized('Your session has ended. Please sign in again.', { code: 'SESSION_REVOKED' });
  }
  return user;
}
