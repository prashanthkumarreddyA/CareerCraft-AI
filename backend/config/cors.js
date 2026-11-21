import { config } from './env.js';
import { ApiError } from '../utils/ApiError.js';

// Only the configured frontend origin(s) may call the API from a browser.
// Requests without an Origin header (curl, Render health checks, server-to-server) are allowed;
// CORS is a browser protection, and authentication protects the data itself.
export const corsOptions = {
  origin(origin, callback) {
    if (!origin || config.clientUrls.includes(origin)) return callback(null, true);
    return callback(ApiError.forbidden('Origin not allowed by CORS', { code: 'CORS_ORIGIN_DENIED' }));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false, // auth uses the Authorization header, not cookies
  maxAge: 600,
};
