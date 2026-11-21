import mongoose from 'mongoose';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

mongoose.set('strictQuery', true);

const STATES = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
let retryTimer = null;
let stopping = false;

export function getDatabaseStatus() {
  if (!config.mongoUri) return 'not_configured';
  return STATES[mongoose.connection.readyState] ?? 'unknown';
}

mongoose.connection.on('connected', () => logger.info('MongoDB connected'));
mongoose.connection.on('disconnected', () => !stopping && logger.warn('MongoDB disconnected'));
mongoose.connection.on('error', (err) => logger.error('MongoDB error', { error: err.message }));

/**
 * Connects in the background with exponential backoff, so the HTTP server (and its
 * health check) stays up while Atlas is unreachable. Mongoose reconnects on its own
 * after the first successful connection.
 */
export function connectDatabase(attempt = 1) {
  if (!config.mongoUri) {
    logger.debug('MONGODB_URI is not set; skipping database connection');
    return;
  }
  mongoose
    .connect(config.mongoUri, { serverSelectionTimeoutMS: 10_000, maxPoolSize: 10 })
    .catch((err) => {
      if (stopping) return;
      const delay = Math.min(30_000, 1_000 * 2 ** (attempt - 1));
      logger.error('MongoDB connection failed', { attempt, retryInMs: delay, error: err.message });
      retryTimer = setTimeout(() => connectDatabase(attempt + 1), delay);
    });
}

export async function disconnectDatabase() {
  stopping = true;
  clearTimeout(retryTimer);
  await mongoose.disconnect();
}
