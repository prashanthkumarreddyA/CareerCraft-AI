// Gemini provider behaviour with a fake SDK client (no network): model validation, structured
// output, retries/backoff, rate limits, timeouts, invalid answers, fallbacks and safe logging.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { ApiError as GenAiApiError } from '@google/genai';
import { createGeminiProvider, classifyGeminiError } from '../services/ai/gemini.provider.js';

const schema = z.object({ languages: z.array(z.string()) });
const jsonSchema = { type: 'object', properties: { languages: { type: 'array', items: { type: 'string' } } } };
const request = { task: 'test', systemInstruction: 'sys', prompt: 'PROMPT-CANARY-123 We need Go.', schema, jsonSchema };

const ok = (text = '{"languages":["Go"]}', extra = {}) => ({ text, candidates: [{ finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 }, ...extra });
const apiErr = (status, message = `{"error":{"code":${status}}}`) => new GenAiApiError({ status, message });
const abortErr = () => Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });

/** Fake SDK: `script` is a list of responses/errors consumed per generateContent call (per model if an object). */
function fakeClient(script, { getModel = async ({ model }) => ({ name: `models/${model}`, supportedActions: ['generateContent'] }) } = {}) {
  const calls = { get: [], generate: [] };
  const queues = Array.isArray(script) ? { '*': [...script] } : Object.fromEntries(Object.entries(script).map(([k, v]) => [k, [...v]]));
  return {
    calls,
    models: {
      get: async (params) => {
        calls.get.push(params.model);
        return getModel(params);
      },
      generateContent: async (params) => {
        calls.generate.push(params);
        const queue = queues[params.model] ?? queues['*'];
        const next = queue.shift();
        if (next === undefined) throw new Error(`no scripted response for ${params.model}`);
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
}

function provider(client, opts = {}) {
  const sleeps = [];
  let clock = 0;
  const p = createGeminiProvider({
    apiKey: 'test-key',
    model: 'model-a',
    client,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
    random: () => 0,
    ...opts,
  });
  return Object.assign(p, { sleeps, advance: (ms) => (clock += ms) });
}

test('success: structured JSON request, validated answer, usage + model reported', async () => {
  const client = fakeClient([ok()]);
  const p = provider(client, { thinkingLevel: 'LOW' });
  const result = await p.generateJson(request);
  assert.deepEqual(result.data, { languages: ['Go'] });
  assert.equal(result.model, 'model-a');
  assert.equal(result.attempts, 1);
  assert.equal(result.usage.totalTokens, 15);
  const sent = client.calls.generate[0];
  assert.equal(sent.config.responseMimeType, 'application/json');
  assert.deepEqual(sent.config.responseJsonSchema, jsonSchema);
  assert.equal(sent.config.temperature, 0);
  assert.equal(sent.config.thinkingConfig.thinkingLevel, 'LOW');
  assert.ok(sent.config.abortSignal instanceof AbortSignal);
});

test('model is validated once before use and cached', async () => {
  const client = fakeClient([ok(), ok()]);
  const p = provider(client);
  await p.generateJson(request);
  await p.generateJson(request);
  assert.deepEqual(client.calls.get, ['model-a']);
});

test('a model that cannot generate content is skipped for the fallback model', async () => {
  const client = fakeClient({ 'model-b': [ok()] }, { getModel: async ({ model }) => ({ supportedActions: model === 'model-a' ? ['embedContent'] : ['generateContent'] }) });
  const result = await provider(client, { fallbackModels: ['model-b'] }).generateJson(request);
  assert.equal(result.model, 'model-b');
  assert.equal(client.calls.generate.length, 1);
});

test('a retired model (404 on generate) falls back; without fallback it is AI_MODEL_UNAVAILABLE', async () => {
  const retired = () => apiErr(404, '{"error":{"code":404,"message":"This model is no longer available to new users."}}');
  const withFallback = await provider(fakeClient({ 'model-a': [retired()], 'model-b': [ok()] }), { fallbackModels: ['model-b'] }).generateJson(request);
  assert.equal(withFallback.model, 'model-b');
  await assert.rejects(provider(fakeClient([retired()])).generateJson(request), { statusCode: 503, code: 'AI_MODEL_UNAVAILABLE' });
});

test('model validation 404 maps to AI_MODEL_UNAVAILABLE', async () => {
  const client = fakeClient([], { getModel: async () => { throw apiErr(404); } });
  await assert.rejects(provider(client).generateJson(request), { code: 'AI_MODEL_UNAVAILABLE' });
});

test('rate limit with a short retryDelay is retried after that delay', async () => {
  const limited = apiErr(429, '{"error":{"code":429,"details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"7s"}]}}');
  const p = provider(fakeClient([limited, ok()]));
  const result = await p.generateJson(request);
  assert.equal(result.attempts, 2);
  assert.deepEqual(p.sleeps, [7000]);
});

test('daily quota exhaustion is not retried: 429 AI_RATE_LIMITED with retry-after', async () => {
  const quota = apiErr(429, '{"error":{"code":429,"details":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel"},{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"3600s"}]}}');
  const client = fakeClient([quota]);
  await assert.rejects(provider(client).generateJson(request), (err) => err.statusCode === 429 && err.code === 'AI_RATE_LIMITED' && err.details.retryAfterSeconds === 3600);
  assert.equal(client.calls.generate.length, 1);
});

test('overloaded (503) is retried with exponential backoff, then reported as AI_UNAVAILABLE', async () => {
  const client = fakeClient([apiErr(503), apiErr(503), apiErr(503)]);
  const p = provider(client, { maxAttempts: 3 });
  await assert.rejects(p.generateJson(request), { statusCode: 503, code: 'AI_UNAVAILABLE' });
  assert.equal(client.calls.generate.length, 3);
  assert.deepEqual(p.sleeps, [1500, 3000]);
});

test('overloaded primary model falls back to the next model', async () => {
  const client = fakeClient({ 'model-a': [apiErr(503), apiErr(503)], 'model-b': [ok()] });
  const result = await provider(client, { maxAttempts: 2, fallbackModels: ['model-b'] }).generateJson(request);
  assert.equal(result.model, 'model-b');
  assert.equal(result.attempts, 3);
});

test('timeouts are retried and reported as AI_TIMEOUT (504)', async () => {
  const client = fakeClient([abortErr(), abortErr()]);
  await assert.rejects(provider(client, { maxAttempts: 2 }).generateJson(request), { statusCode: 504, code: 'AI_TIMEOUT' });
  assert.equal(client.calls.generate.length, 2);
});

test('the total time budget stops further retries', async () => {
  const client = fakeClient([apiErr(503), apiErr(503), apiErr(503)]);
  const p = provider(client, { maxAttempts: 3, totalTimeoutMs: 2_000 });
  await assert.rejects(p.generateJson(request), { code: 'AI_UNAVAILABLE' });
  assert.equal(client.calls.generate.length, 1); // a 1.5 s backoff would leave < 1 s: give up
});

test('invalid JSON is retried once, then AI_INVALID_RESPONSE (502)', async () => {
  const recovered = await provider(fakeClient([ok('{"languages": [unterminated'), ok()])).generateJson(request);
  assert.equal(recovered.attempts, 2);
  await assert.rejects(provider(fakeClient([ok('not json'), ok('still not json'), ok()])).generateJson(request), { statusCode: 502, code: 'AI_INVALID_RESPONSE' });
});

test('JSON that does not match the schema is rejected as AI_INVALID_RESPONSE', async () => {
  const client = fakeClient([ok('{"languages":"Go"}'), ok('{"langs":["Go"]}')]);
  await assert.rejects(provider(client).generateJson(request), { code: 'AI_INVALID_RESPONSE' });
});

test('empty answers (e.g. MAX_TOKENS) are treated as invalid responses', async () => {
  const client = fakeClient([ok('', { candidates: [{ finishReason: 'MAX_TOKENS' }] }), ok()]);
  assert.equal((await provider(client).generateJson(request)).attempts, 2);
});

test('blocked prompts are not retried: 422 AI_BLOCKED', async () => {
  const client = fakeClient([ok(undefined, { text: undefined, promptFeedback: { blockReason: 'SAFETY' } })]);
  await assert.rejects(provider(client).generateJson(request), { statusCode: 422, code: 'AI_BLOCKED' });
  assert.equal(client.calls.generate.length, 1);
});

test('an invalid API key is not retried and does not fall back: AI_AUTH_FAILED', async () => {
  const client = fakeClient([apiErr(400, '{"error":{"code":400,"message":"API key not valid.","details":[{"reason":"API_KEY_INVALID"}]}}')]);
  await assert.rejects(provider(client, { fallbackModels: ['model-b'] }).generateJson(request), { statusCode: 503, code: 'AI_AUTH_FAILED' });
  assert.equal(client.calls.generate.length, 1);
});

test('missing configuration or a malformed model id: AI_NOT_CONFIGURED', async () => {
  for (const opts of [{ apiKey: '' }, { model: '' }, { model: 'gemini flash; DROP' }]) {
    const p = provider(fakeClient([ok()]), opts);
    assert.equal(p.isConfigured, false);
    await assert.rejects(p.generateJson(request), { statusCode: 503, code: 'AI_NOT_CONFIGURED' });
  }
  assert.deepEqual(provider(fakeClient([]), { model: 'models/gemini-x-flash' }).models, ['gemini-x-flash']);
});

test('error classification covers network errors and server errors', () => {
  assert.equal(classifyGeminiError(new TypeError('fetch failed')).retryable, true);
  assert.equal(classifyGeminiError(apiErr(500)).kind, 'UNAVAILABLE');
  assert.equal(classifyGeminiError(apiErr(504)).kind, 'TIMEOUT');
  assert.equal(classifyGeminiError(apiErr(403)).kind, 'AUTH');
  assert.equal(classifyGeminiError(apiErr(400, 'Invalid schema')).kind, 'REQUEST_REJECTED');
});

test('logs never contain the prompt, the answer or the API key', async () => {
  const written = [];
  const capture = (stream) => {
    const original = stream.write.bind(stream);
    stream.write = (chunk) => {
      written.push(String(chunk)); // captured, not printed
      return true;
    };
    return () => (stream.write = original);
  };
  const restoreOut = capture(process.stdout);
  const restoreErr = capture(process.stderr);
  try {
    const client = fakeClient([apiErr(503), ok('{"languages": [broken'), ok('{"languages":["ANSWER-CANARY"]}')]);
    await provider(client, { apiKey: 'KEY-CANARY-456' }).generateJson(request);
  } finally {
    restoreOut();
    restoreErr();
  }
  const log = written.join('');
  assert.ok(log.includes('AI request attempt failed')); // something was logged
  for (const canary of ['PROMPT-CANARY-123', 'ANSWER-CANARY', 'KEY-CANARY-456', 'We need Go']) assert.equal(log.includes(canary), false, canary);
});
