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

/**
 * CORS origins: scheme + host (+ port) only. A browser's Origin header never contains a path, so
 * "https://site.netlify.app/login" is reduced to "https://site.netlify.app" (and reported by
 * checkEnvironment). Entries that are not valid http(s) URLs are dropped and reported.
 */
export function parseOrigins(raw) {
  const origins = [];
  const adjusted = [];
  const invalid = [];
  for (const entry of String(raw ?? '').split(',').map((v) => v.trim()).filter(Boolean)) {
    try {
      const url = new URL(entry);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('not http(s)');
      if (url.origin !== entry) adjusted.push(url.origin);
      if (!origins.includes(url.origin)) origins.push(url.origin);
    } catch {
      invalid.push(entry);
    }
  }
  return { origins, adjusted, invalid };
}

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
  clientUrls: parseOrigins(str('CLIENT_URL', isProduction ? '' : 'http://localhost:5180,http://127.0.0.1:5180,http://localhost:4180')).origins,
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
  const { adjusted, invalid } = parseOrigins(str('CLIENT_URL'));
  if (adjusted.length) warnings.push(`CLIENT_URL entries were reduced to their origin (no path or trailing slash): ${adjusted.join(', ')}`);
  if (invalid.length) warnings.push(`CLIENT_URL has ${invalid.length} entr${invalid.length === 1 ? 'y' : 'ies'} that are not http(s) URLs and were ignored`);
  if (isProduction && !config.clientUrls.length) errors.push('CLIENT_URL must contain at least one valid origin, e.g. https://your-site.netlify.app');
  if (isProduction && config.clientUrls.some((u) => /localhost|127\.0\.0\.1/.test(u))) {
    warnings.push('CLIENT_URL contains a localhost origin in production');
  }
  return { errors, warnings };
}
