import fs from 'node:fs';
import { config } from '../config/env.js';
import { getDatabaseStatus } from '../config/db.js';

const startedAt = Date.now();
const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/**
 * GET /api/health
 * Always 200 while the process is serving requests, so Render's health check reflects
 * the web server itself; dependency status is reported in the body for the frontend.
 */
export function getHealth(req, res) {
  const database = getDatabaseStatus();
  // Only whether AI is configured: no model names, keys or quota details.
  const ai = req.app.locals.ai?.isConfigured ? 'configured' : 'not_configured';
  res.set('Cache-Control', 'no-store').json({
    success: true,
    data: {
      status: database === 'connected' || database === 'not_configured' ? 'ok' : 'degraded',
      service: 'ai-resume-builder-api',
      version,
      environment: config.nodeEnv,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),
      dependencies: { database, ai },
    },
  });
}
