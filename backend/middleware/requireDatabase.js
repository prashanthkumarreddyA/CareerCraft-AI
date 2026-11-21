import mongoose from 'mongoose';
import { ApiError } from '../utils/ApiError.js';

/** Fails fast with 503 instead of letting Mongoose buffer queries while the database is down. */
export function requireDatabase(_req, _res, next) {
  if (mongoose.connection.readyState !== 1) {
    return next(ApiError.serviceUnavailable('The database is temporarily unavailable. Please try again shortly.', { code: 'DATABASE_UNAVAILABLE' }));
  }
  next();
}
