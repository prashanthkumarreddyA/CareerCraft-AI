import { config } from '../config/env.js';

// Minimal leveled logger: JSON lines in production (Render log search friendly),
// readable text in development. Never pass secrets or resume content to it.
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

function write(level, message, meta) {
  if (config.isTest || LEVELS[level] > threshold) return;
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  if (config.isProduction) {
    stream.write(JSON.stringify({ time: new Date().toISOString(), level, message, ...meta }) + '\n');
  } else {
    const extra = meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    stream.write(`[${level.toUpperCase()}] ${message}${extra}\n`);
  }
}

export const logger = {
  error: (message, meta) => write('error', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  info: (message, meta) => write('info', message, meta),
  debug: (message, meta) => write('debug', message, meta),
};
