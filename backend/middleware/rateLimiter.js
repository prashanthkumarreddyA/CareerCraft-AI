import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { config } from '../config/env.js';

const limited = (message) => ({ success: false, error: { code: 'RATE_LIMITED', message } });
const base = { standardHeaders: 'draft-8', legacyHeaders: false, skip: () => config.isTest };

/** General limit for all API routes. */
export const apiLimiter = rateLimit({
  ...base,
  skip: undefined, // keep the general limiter active in tests too (it is generous)
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.max,
  message: limited('Too many requests. Please wait a few minutes and try again.'),
});

/** Brute-force protection for login/register, per IP. */
export const authLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 20,
  message: limited('Too many sign-in attempts. Please wait 15 minutes and try again.'),
});

/** Upload/replace limit, per signed-in user (falls back to IP). */
export const uploadLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: 20,
  keyGenerator: (req) => (req.user ? `user:${req.user.id}` : ipKeyGenerator(req.ip)),
  message: limited('Too many uploads in the last hour. Please try again later.'),
});

/**
 * AI analysis limit, per signed-in user. Protects the Gemini quota (and cost) from one account.
 * Built by a factory so tests can exercise it with a small limit.
 */
export function createAiLimiter({ limit = 30, windowMs = 60 * 60 * 1000, skip = () => config.isTest } = {}) {
  return rateLimit({
    ...base,
    skip,
    windowMs,
    limit,
    keyGenerator: (req) => (req.user ? `user:${req.user.id}` : ipKeyGenerator(req.ip)),
    message: limited('You have run many analyses in the last hour. Please try again later.'),
  });
}

export const aiLimiter = createAiLimiter();
