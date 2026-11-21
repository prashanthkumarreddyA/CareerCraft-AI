import { config, checkEnvironment } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { createApp } from './app.js';
import { logger } from './utils/logger.js';

const { errors, warnings } = checkEnvironment();
warnings.forEach((w) => logger.warn(w));
if (errors.length) {
  errors.forEach((e) => logger.error(e));
  process.exit(1);
}

const app = createApp();
const server = app.listen(config.port, () => {
  logger.info(`API listening on port ${config.port}`, { environment: config.nodeEnv, allowedOrigins: config.clientUrls });
});
connectDatabase();

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, shutting down`);
  const force = setTimeout(() => process.exit(1), 10_000).unref();
  server.close(async () => {
    await disconnectDatabase().catch(() => {});
    clearTimeout(force);
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => logger.error('Unhandled promise rejection', { error: String(reason?.message ?? reason) }));
