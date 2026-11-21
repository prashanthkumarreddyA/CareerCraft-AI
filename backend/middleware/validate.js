import { ApiError } from '../utils/ApiError.js';

/** Validates and replaces req.body with the parsed value. Error details list paths, never submitted values. */
export const validateBody = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return next(ApiError.badRequest('Please correct the highlighted fields.', { code: 'VALIDATION_ERROR', details }));
  }
  req.body = result.data;
  next();
};
