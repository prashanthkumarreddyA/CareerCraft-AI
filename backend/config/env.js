import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Load backend/.env for local development. On Render, variables come from the dashboard
// and no .env file exists. Variables already set in the environment are not overridden.
const envPath = fileURLToPath(new URL('../.env', import.meta.url));
if (process.env.NODE_ENV !== 'test' && fs.existsSync(envPath)) process.loadEnvFile(envPath);

const str = (name, fallback = '') => (process.env[name] ?? '').trim() || fallback;
const int = (name, fallback) => {
  const raw = str(name);
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) throw new Error(`Environment variable ${name} must be an integer`);
  return value;
};
const list = (name, fallback) =>
  str(name, fallback)
    .split(',')
    .map((v) => v.trim().replace(/\/+$/, ''))
    .filter(Boolean);

const nodeEnv = str('NODE_ENV', 'development');
const isProduction = nodeEnv === 'production';

// Outside production a missing JWT_SECRET falls back to a per-process random secret
// (sessions end on restart). Production refuses to start without one (see checkEnvironment).
const jwtSecret = str('JWT_SECRET') || (isProduction ? '' : crypto.randomBytes(48).toString('hex'));

export const config = Object.freeze({
  nodeEnv,
  isProduction,
  isTest: nodeEnv === 'test',
  port: int('PORT', 5000),
  clientUrls: list('CLIENT_URL', isProduction ? '' : 'http://localhost:5180,http://127.0.0.1:5180,http://localhost:4180'),
  trustProxy: int('TRUST_PROXY', isProduction ? 1 : 0),
  logLevel: str('LOG_LEVEL', 'info'),
  rateLimit: { windowMs: int('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000), max: int('RATE_LIMIT_MAX', 300) },
  mongoUri: str('MONGODB_URI'),
  jwt: { secret: jwtSecret, expiresIn: str('JWT_EXPIRES_IN', '7d'), ephemeral: !str('JWT_SECRET') },
  bcryptRounds: int('BCRYPT_ROUNDS', 12),
  upload: { maxBytes: int('MAX_UPLOAD_SIZE_MB', 5) * 1024 * 1024 },
  gemini: {
    apiKey: str('GEMINI_API_KEY'),
    model: str('GEMINI_MODEL'),
    // Tried in order when the primary model is unavailable (retired, overloaded or timing out).
    fallbackModels: list('GEMINI_FALLBACK_MODELS', ''),
    // Optional reasoning depth for models that support it (e.g. LOW, MEDIUM, HIGH). Empty = model default.
    thinkingLevel: str('GEMINI_THINKING_LEVEL').toUpperCase(),
    timeoutMs: int('GEMINI_TIMEOUT_MS', 90_000), // per attempt
    totalTimeoutMs: int('GEMINI_TOTAL_TIMEOUT_MS', 170_000), // whole request incl. retries and fallbacks
    maxAttempts: int('GEMINI_MAX_ATTEMPTS', 3), // per model
  },
  cloudinary: {
    cloudName: str('CLOUDINARY_CLOUD_NAME'),
    apiKey: str('CLOUDINARY_API_KEY'),
    apiSecret: str('CLOUDINARY_API_SECRET'),
    signedUrlTtlSeconds: int('SIGNED_URL_TTL_SECONDS', 300),
  },
});

// Variables each feature needs. Implemented features are required in production; features
// from later phases only produce warnings until they land.
const REQUIRED_IN_PRODUCTION = ['CLIENT_URL', 'MONGODB_URI', 'JWT_SECRET', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
const RECOMMENDED = ['MONGODB_URI', 'JWT_SECRET', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];

/** Returns { errors, warnings } listing variable NAMES only (never values). */
export function checkEnvironment() {
  const missing = (name) => !str(name);
  const errors = isProduction ? REQUIRED_IN_PRODUCTION.filter(missing).map((n) => `${n} is required in production`) : [];
  const warnings = RECOMMENDED.filter(missing)
    .filter((n) => !(isProduction && REQUIRED_IN_PRODUCTION.includes(n)))
    .map((n) => (n === 'JWT_SECRET' ? 'JWT_SECRET is not set; using a temporary secret (sessions end on restart)' : `${n} is not set; dependent features are disabled`));
  if (config.jwt.secret && config.jwt.secret.length < 32) warnings.push('JWT_SECRET should be at least 32 characters');
  if (isProduction && config.clientUrls.some((u) => /localhost|127\.0\.0\.1/.test(u))) {
    warnings.push('CLIENT_URL contains a localhost origin in production');
  }
  return { errors, warnings };
}
