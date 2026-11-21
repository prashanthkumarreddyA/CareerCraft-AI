import { ApiError } from '../../utils/ApiError.js';

/**
 * Provider-neutral AI failures. Every AI provider maps its own errors onto these codes, so
 * controllers, the frontend and tests never depend on a specific vendor SDK.
 * Messages are safe to show to users: they never contain prompts, resume text or credentials.
 */
export const AI_ERRORS = {
  NOT_CONFIGURED: [503, 'AI_NOT_CONFIGURED', 'AI analysis is not configured on the server.'],
  MODEL_UNAVAILABLE: [503, 'AI_MODEL_UNAVAILABLE', 'The configured AI model is not available. Please try again later.'],
  AUTH: [503, 'AI_AUTH_FAILED', 'The AI service rejected the server credentials.'],
  RATE_LIMITED: [429, 'AI_RATE_LIMITED', 'The AI service is receiving too many requests. Please wait a minute and try again.'],
  UNAVAILABLE: [503, 'AI_UNAVAILABLE', 'The AI service is temporarily overloaded. Please try again in a few minutes.'],
  TIMEOUT: [504, 'AI_TIMEOUT', 'The AI service took too long to respond. Please try again.'],
  INVALID_RESPONSE: [502, 'AI_INVALID_RESPONSE', 'The AI service returned an unusable answer. Please try again.'],
  BLOCKED: [422, 'AI_BLOCKED', 'The AI service declined to process this text. Please check the job description and try again.'],
  REQUEST_REJECTED: [502, 'AI_REQUEST_REJECTED', 'The AI service rejected the request.'],
};

export function aiError(kind, { details } = {}) {
  const [status, code, message] = AI_ERRORS[kind];
  return new ApiError(status, message, { code, details });
}

/**
 * @typedef {object} AiJsonRequest
 * @property {string} task              short label for logs/metrics (never content)
 * @property {string} systemInstruction rules for the model
 * @property {string} prompt            user content (job description + evidence)
 * @property {import('zod').ZodType} schema  validates the parsed JSON answer
 * @property {object} jsonSchema        JSON Schema sent to the provider for structured output
 * @property {number} [maxOutputTokens]
 *
 * @typedef {object} AiJsonResult
 * @property {any} data       parsed and schema-validated answer
 * @property {string} provider
 * @property {string} model   model that produced the answer (may be a fallback)
 * @property {number} attempts
 * @property {number} latencyMs
 * @property {{ inputTokens?: number, outputTokens?: number, totalTokens?: number }} usage
 *
 * @typedef {object} AiProvider
 * @property {string} name
 * @property {boolean} isConfigured
 * @property {(req: AiJsonRequest) => Promise<AiJsonResult>} generateJson
 */
