import { ApiError } from '../utils/ApiError.js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

export function notFound(req, _res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl.split('?')[0]}`));
}

// Body-parser errors carry a `type`; map them to clear client errors.
const PARSER_ERRORS = {
  'entity.parse.failed': [400, 'INVALID_JSON', 'Request body is not valid JSON.'],
  'entity.too.large': [413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.'],
  'encoding.unsupported': [415, 'UNSUPPORTED_ENCODING', 'Unsupported request encoding.'],
};

const MULTER_ERRORS = {
  LIMIT_FILE_SIZE: [413, 'FILE_TOO_LARGE', `The file is too large. The maximum size is ${Math.round(config.upload.maxBytes / 1024 / 1024)} MB.`],
  LIMIT_FILE_COUNT: [400, 'TOO_MANY_FILES', 'Upload one file at a time.'],
  LIMIT_UNEXPECTED_FILE: [400, 'UNEXPECTED_FILE_FIELD', 'Send the PDF in the "resume" form field.'],
  LIMIT_PART_COUNT: [400, 'TOO_MANY_PARTS', 'The upload has too many parts.'],
  LIMIT_FIELD_COUNT: [400, 'TOO_MANY_FIELDS', 'The upload has too many fields.'],
};

const DB_UNAVAILABLE = new Set(['MongoServerSelectionError', 'MongoNetworkError', 'MongoNotConnectedError', 'MongooseServerSelectionError']);

// Express recognises error handlers by their 4-argument signature, so `_next` must stay.
export function errorHandler(err, req, res, _next) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong on our side. Please try again.';
  let details;

  if (err instanceof ApiError) {
    ({ statusCode: status, message, details } = err);
    code = err.code ?? code;
  } else if (PARSER_ERRORS[err.type]) {
    [status, code, message] = PARSER_ERRORS[err.type];
  } else if (err.name === 'MulterError') {
    [status, code, message] = MULTER_ERRORS[err.code] ?? [400, 'UPLOAD_ERROR', 'The upload could not be processed.'];
  } else if (err.name === 'CastError') {
    [status, code, message] = [400, 'INVALID_ID', 'Invalid identifier.'];
  } else if (err.name === 'ValidationError') {
    // Mongoose messages can echo stored values; report field names only.
    [status, code, message] = [400, 'VALIDATION_ERROR', 'Some fields are invalid.'];
    details = Object.keys(err.errors ?? {}).map((path) => ({ path }));
  } else if (err.code === 11000) {
    [status, code, message] = [409, 'DUPLICATE', 'This record already exists.'];
  } else if (DB_UNAVAILABLE.has(err.name)) {
    [status, code, message] = [503, 'DATABASE_UNAVAILABLE', 'The database is temporarily unavailable. Please try again shortly.'];
  }

  if (status >= 500) {
    // Error messages here come from libraries (DB driver, Cloudinary, pdf.js), not from request bodies.
    logger.error('Request failed', { method: req.method, path: req.originalUrl.split('?')[0], status, code, error: err.message, stack: config.isProduction ? undefined : err.stack });
  }

  res.status(status).json({ success: false, error: { code, message, ...(details ? { details } : {}) } });
}
