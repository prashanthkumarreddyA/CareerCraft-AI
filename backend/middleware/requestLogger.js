import morgan from 'morgan';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

// Logs method, path, status and duration only. Query strings are stripped and bodies
// are never logged, so tokens and resume content stay out of the logs.
morgan.token('path', (req) => req.originalUrl.split('?')[0]);

export const requestLogger = morgan(':method :path :status :res[content-length] - :response-time ms', {
  skip: (req) => config.isTest || (req.originalUrl === '/api/health' && config.isProduction),
  stream: { write: (line) => logger.info(line.trim()) },
});
