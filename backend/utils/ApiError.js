/** An error whose message is safe to show to the client (never include secrets or resume text). */
export class ApiError extends Error {
  constructor(statusCode, message, { code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(message, opts) {
    return new ApiError(400, message, { code: 'BAD_REQUEST', ...opts });
  }

  static unauthorized(message = 'Please sign in to continue.', opts) {
    return new ApiError(401, message, { code: 'UNAUTHORIZED', ...opts });
  }

  static forbidden(message = 'Forbidden', opts) {
    return new ApiError(403, message, { code: 'FORBIDDEN', ...opts });
  }

  static notFound(message = 'Not found', opts) {
    return new ApiError(404, message, { code: 'NOT_FOUND', ...opts });
  }

  static conflict(message, opts) {
    return new ApiError(409, message, { code: 'CONFLICT', ...opts });
  }

  static unprocessable(message, opts) {
    return new ApiError(422, message, { code: 'UNPROCESSABLE', ...opts });
  }

  static serviceUnavailable(message, opts) {
    return new ApiError(503, message, { code: 'SERVICE_UNAVAILABLE', ...opts });
  }

  static badGateway(message, opts) {
    return new ApiError(502, message, { code: 'BAD_GATEWAY', ...opts });
  }
}
