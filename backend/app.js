import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config/env.js';
import { corsOptions } from './config/cors.js';
import { requestLogger } from './middleware/requestLogger.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import healthRoutes from './routes/health.routes.js';
import apiRoutes from './routes/index.js';
import { cloudinaryStorage } from './services/cloudinary.service.js';
import { getDefaultAiProvider } from './services/ai/index.js';

/**
 * Builds the Express app without opening a port or a DB connection (used by server.js and tests).
 * @param {object} [deps.storage] file storage provider (Cloudinary by default; tests inject a fake)
 * @param {object} [deps.ai] AI provider (Gemini by default; tests inject a fake)
 */
export function createApp({ storage = cloudinaryStorage, ai = getDefaultAiProvider() } = {}) {
  const app = express();
  app.locals.storage = storage;
  app.locals.ai = ai;

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(helmet());
  app.use(cors(corsOptions));
  app.use(requestLogger);
  app.use(express.json({ limit: '1mb' })); // long job descriptions fit comfortably

  // Health is outside the rate limiter: the frontend polls it while Render wakes up.
  app.use('/api/health', healthRoutes);
  app.use('/api', apiLimiter, apiRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
