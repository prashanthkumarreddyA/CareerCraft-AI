import { GoogleGenAI } from '@google/genai';
import { logger } from '../../utils/logger.js';
import { aiError } from './ai-errors.js';

/**
 * Gemini implementation of the AiProvider contract (see ai-errors.js).
 *
 * - The API key is read from the backend environment and never leaves the server.
 * - Each model is validated (exists + supports generateContent) before its first request and
 *   re-validated if Gemini later reports it unavailable.
 * - Structured output: responseMimeType JSON + a JSON Schema; the answer is then parsed and
 *   validated with zod. Unusable answers are retried, then reported as AI_INVALID_RESPONSE.
 * - Retries with exponential backoff + jitter on 429 (short waits only), 5xx, timeouts and
 *   network errors, within a total time budget; then optional fallback models are tried.
 * - Logs contain task, model, attempt and status codes only: never prompts or answers.
 */

const MODEL_ID = /^[a-z0-9][a-z0-9.\-]{1,80}$/;
const MODEL_CACHE_MS = 60 * 60 * 1000;
const MAX_RATE_LIMIT_WAIT_MS = 20_000;
const MAX_INVALID_RESPONSE_ATTEMPTS = 2;

export const normalizeModelId = (model) => String(model ?? '').trim().replace(/^models\//, '');

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Extracts "retryDelay": "12s" from a Gemini 429 error body, in ms. */
function parseRetryDelayMs(message) {
  const match = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(message ?? '');
  return match ? Math.ceil(Number(match[1]) * 1000) : null;
}

/** Classifies an SDK/network error. Returns { kind, retryable, nextModel, retryAfterMs }. */
export function classifyGeminiError(err) {
  const status = typeof err?.status === 'number' ? err.status : undefined;
  const message = String(err?.message ?? '');
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') return { kind: 'TIMEOUT', retryable: true, nextModel: true };
  if (status === undefined) {
    // fetch failures (DNS, reset connections) surface as TypeError without a status.
    return { kind: 'UNAVAILABLE', retryable: true, nextModel: true };
  }
  if (status === 429) {
    const retryAfterMs = parseRetryDelayMs(message);
    const daily = /PerDay/i.test(message);
    return { kind: 'RATE_LIMITED', retryable: !daily && retryAfterMs !== null && retryAfterMs <= MAX_RATE_LIMIT_WAIT_MS, nextModel: true, retryAfterMs };
  }
  if (status === 401 || status === 403 || /API_KEY_INVALID|API key not valid|PERMISSION_DENIED/i.test(message)) {
    return { kind: 'AUTH', retryable: false, nextModel: false };
  }
  if (status === 404) return { kind: 'MODEL_UNAVAILABLE', retryable: false, nextModel: true };
  if (status >= 500) return { kind: status === 504 ? 'TIMEOUT' : 'UNAVAILABLE', retryable: true, nextModel: true };
  return { kind: 'REQUEST_REJECTED', retryable: false, nextModel: false };
}

class InvalidAnswer extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'InvalidAnswer';
  }
}

export function createGeminiProvider({
  apiKey,
  model,
  fallbackModels = [],
  thinkingLevel = '',
  timeoutMs = 90_000,
  totalTimeoutMs = 170_000,
  maxAttempts = 3,
  client, // injectable for tests: { models: { get, generateContent } }
  sleep = defaultSleep,
  now = () => Date.now(),
  random = Math.random,
} = {}) {
  const models = [normalizeModelId(model), ...fallbackModels.map(normalizeModelId)].filter((m, i, all) => m && all.indexOf(m) === i);
  const isConfigured = Boolean(apiKey && models.length && models.every((m) => MODEL_ID.test(m)));
  let sdk = client;
  const validated = new Map(); // model -> expiry timestamp

  const getClient = () => {
    if (!isConfigured) throw aiError('NOT_CONFIGURED');
    sdk ??= new GoogleGenAI({ apiKey });
    return sdk;
  };

  async function validateModel(modelId, signal) {
    const expiry = validated.get(modelId);
    if (expiry && expiry > now()) return;
    let info;
    try {
      info = await getClient().models.get({ model: modelId, config: { abortSignal: signal } });
    } catch (err) {
      const c = classifyGeminiError(err);
      throw Object.assign(new Error(`model validation failed (${c.kind})`), { classified: c, cause: err });
    }
    const actions = info?.supportedActions ?? [];
    if (actions.length && !actions.includes('generateContent')) {
      throw Object.assign(new Error('model does not support generateContent'), { classified: { kind: 'MODEL_UNAVAILABLE', retryable: false, nextModel: true } });
    }
    validated.set(modelId, now() + MODEL_CACHE_MS);
  }

  function parseAnswer(response, schema) {
    const blockReason = response?.promptFeedback?.blockReason;
    if (blockReason) throw Object.assign(new Error('prompt blocked'), { classified: { kind: 'BLOCKED', retryable: false, nextModel: false } });
    const finishReason = response?.candidates?.[0]?.finishReason;
    if (finishReason && ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII'].includes(finishReason)) {
      throw Object.assign(new Error(`answer blocked (${finishReason})`), { classified: { kind: 'BLOCKED', retryable: false, nextModel: false } });
    }
    const text = response?.text;
    if (!text) throw new InvalidAnswer(`empty answer (finishReason ${finishReason ?? 'unknown'})`);
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new InvalidAnswer(`answer is not valid JSON (finishReason ${finishReason ?? 'unknown'})`);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      // Paths only: issue messages could quote model output derived from the job description.
      const paths = parsed.error.issues.slice(0, 5).map((i) => i.path.join('.') || '(root)');
      throw new InvalidAnswer(`answer does not match the schema at: ${paths.join(', ')}`);
    }
    return parsed.data;
  }

  /** @type {import('./ai-errors.js').AiProvider['generateJson']} */
  async function generateJson({ task, systemInstruction, prompt, schema, jsonSchema, maxOutputTokens = 16_384 }) {
    const cli = getClient();
    const started = now();
    const deadline = started + totalTimeoutMs;
    let attempts = 0;
    let last = { kind: 'UNAVAILABLE' };

    for (const modelId of models) {
      let invalidAnswers = 0;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const remaining = deadline - now();
        if (remaining < 1_000) {
          last = { kind: 'TIMEOUT' };
          break;
        }
        const signal = AbortSignal.timeout(Math.min(timeoutMs, remaining));
        attempts += 1;
        try {
          await validateModel(modelId, signal);
          const response = await cli.models.generateContent({
            model: modelId,
            contents: prompt,
            config: {
              systemInstruction,
              responseMimeType: 'application/json',
              responseJsonSchema: jsonSchema,
              temperature: 0,
              maxOutputTokens,
              ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
              abortSignal: signal,
            },
          });
          const data = parseAnswer(response, schema);
          const usage = response.usageMetadata ?? {};
          logger.info('AI request succeeded', { task, model: modelId, attempts, latencyMs: now() - started });
          return {
            data,
            provider: 'gemini',
            model: modelId,
            attempts,
            latencyMs: now() - started,
            usage: { inputTokens: usage.promptTokenCount, outputTokens: usage.candidatesTokenCount, totalTokens: usage.totalTokenCount },
          };
        } catch (err) {
          let c;
          if (err instanceof InvalidAnswer) {
            invalidAnswers += 1;
            c = { kind: 'INVALID_RESPONSE', retryable: invalidAnswers < MAX_INVALID_RESPONSE_ATTEMPTS, nextModel: true };
          } else {
            c = err.classified ?? classifyGeminiError(err);
          }
          last = c;
          // Reasons are diagnostics about the request/answer shape (schema paths, Gemini's 4xx
          // explanation), never the prompt or the model's text.
          const reason = err instanceof InvalidAnswer ? err.message : c.kind === 'REQUEST_REJECTED' ? String(err.message).replace(/\s+/g, ' ').slice(0, 300) : undefined;
          logger.warn('AI request attempt failed', { task, model: modelId, attempt, kind: c.kind, status: err.cause?.status ?? err.status, reason });
          if (c.kind === 'MODEL_UNAVAILABLE') validated.delete(modelId);
          if (!c.retryable) {
            if (!c.nextModel) throw aiError(c.kind, c.retryAfterMs ? { details: { retryAfterSeconds: Math.ceil(c.retryAfterMs / 1000) } } : undefined);
            break; // try the next model, if any
          }
          if (attempt < maxAttempts) {
            const backoff = c.retryAfterMs ?? Math.min(15_000, 1_500 * 2 ** (attempt - 1)) + Math.floor(random() * 500);
            if (now() + backoff >= deadline - 1_000) break;
            await sleep(backoff);
          }
        }
      }
    }
    throw aiError(last.kind, last.retryAfterMs ? { details: { retryAfterSeconds: Math.ceil(last.retryAfterMs / 1000) } } : undefined);
  }

  return { name: 'gemini', isConfigured, models, generateJson, validateModel: (m = models[0]) => validateModel(normalizeModelId(m)) };
}
