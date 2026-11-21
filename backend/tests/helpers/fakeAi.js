// In-memory AI provider implementing the same contract as the Gemini provider.
// Tests script the answer (or failure) and inspect every request that was sent.
import { aiError } from '../../services/ai/ai-errors.js';

/** Builds a complete, schema-valid AI answer from partial fields. */
export function aiAnswer({ requirements = [], responsibilities = [], minYears = null, maxYears = null, quote = null, ...rest } = {}) {
  return {
    roleSummary: 'A fictional engineering role used in automated tests.',
    seniority: 'senior',
    requiredExperience: { minYears, maxYears, quote },
    education: null,
    softSkills: [],
    ...rest,
    requirements: requirements.map((r) => ({
      normalizedName: r.term,
      category: 'backend',
      importance: 'must_have',
      classification: 'MISSING',
      evidenceIds: [],
      relatedSkill: null,
      rationale: 'Test rationale.',
      ...r,
    })),
    responsibilities: responsibilities.map((r) => ({ classification: 'MISSING', evidenceIds: [], rationale: 'Test rationale.', ...r })),
  };
}

export function createFakeAi({ answer = aiAnswer(), configured = true } = {}) {
  let next = answer; // object, function(request) => object, or Error to throw
  const requests = [];
  return {
    name: 'fake',
    isConfigured: configured,
    models: ['fake-model'],
    requests,
    respondWith(value) {
      next = value;
    },
    reset() {
      requests.length = 0;
      next = answer;
    },
    async generateJson(request) {
      requests.push(request);
      const value = typeof next === 'function' ? next(request) : next;
      if (value instanceof Error) throw value;
      // Run the real schema and fail the same way the Gemini provider does.
      const parsed = request.schema.safeParse(structuredClone(value));
      if (!parsed.success) throw aiError('INVALID_RESPONSE');
      return { data: parsed.data, provider: 'fake', model: 'fake-model', attempts: 1, latencyMs: 1, usage: {} };
    },
  };
}
