// Live check of the Gemini configuration using ONLY fictional data (sample resume + sample JD).
//   npm run smoke:gemini                 validate model(s) + run one full analysis
//   npm run smoke:gemini -- --models-only
// Prints model ids, timings and the resulting classification; never prints the API key.
import fs from 'node:fs';
import { config } from '../config/env.js';
import { createGeminiProvider } from '../services/ai/gemini.provider.js';
import { analyzeJobDescription } from '../services/job-analysis/analyze-job.js';

const modelsOnly = process.argv.includes('--models-only');
const fixture = (p) => new URL(`../tests/fixtures/${p}`, import.meta.url);

if (!config.gemini.apiKey || !config.gemini.model) {
  console.error('FAIL  GEMINI_API_KEY and GEMINI_MODEL must be set in backend/.env');
  process.exit(1);
}

let failed = false;
const models = [config.gemini.model, ...config.gemini.fallbackModels];
console.log(`Configured model: ${config.gemini.model}${config.gemini.fallbackModels.length ? ` (fallbacks: ${config.gemini.fallbackModels.join(', ')})` : ''}`);

// 1. Each model must exist AND accept a generation request (some listed models refuse generation).
const { z } = await import('zod');
for (const model of models) {
  const provider = createGeminiProvider({ ...config.gemini, model, fallbackModels: [], maxAttempts: 2 });
  const t = Date.now();
  try {
    const { data } = await provider.generateJson({
      task: 'smoke',
      systemInstruction: 'Answer with JSON only.',
      prompt: 'List the programming languages mentioned in: "We need Go and TypeScript developers."',
      schema: z.object({ languages: z.array(z.string()) }),
      jsonSchema: { type: 'object', properties: { languages: { type: 'array', items: { type: 'string' } } }, required: ['languages'] },
      maxOutputTokens: 2048,
    });
    console.log(`PASS  ${model}: generation works (${Date.now() - t} ms) → ${JSON.stringify(data.languages)}`);
  } catch (err) {
    failed = true;
    console.log(`FAIL  ${model}: ${err.code ?? err.name} – ${err.message} (${Date.now() - t} ms)`);
  }
}

// 2. Full pipeline on fictional data.
if (!modelsOnly) {
  const resume = JSON.parse(fs.readFileSync(fixture('sample-resume.json'), 'utf8'));
  const jobDescription = fs.readFileSync(fixture('job-descriptions/sectioned.txt'), 'utf8');
  const t = Date.now();
  try {
    const result = await analyzeJobDescription({ jobTitle: 'Senior Backend Engineer', jobDescription, resume, ai: createGeminiProvider(config.gemini) });
    const { score, requirements, responsibilities, experience, warnings } = result.matchAnalysis;
    console.log(`PASS  full analysis with ${result.ai.model} in ${Date.now() - t} ms (${result.ai.attempts} attempt(s))`);
    console.log(`      score ${score.matchPercentage}% · ${score.totalRequirements} requirements · matched ${score.matchedRequirements} · related ${score.partiallySupportedRequirements} · missing ${score.missingRequirements}`);
    for (const r of requirements) console.log(`      ${r.importance.padEnd(9)} ${r.classification.padEnd(20)} ${r.keyword}${r.relatedSkills.length ? ` (related: ${r.relatedSkills.join(', ')})` : ''}${r.adjustments.length ? '  [adjusted]' : ''}`);
    for (const r of responsibilities) console.log(`      resp      ${r.classification.padEnd(20)} ${r.text.slice(0, 70)}`);
    console.log(`      experience: ${experience.classification ?? 'not scored'} (JD ${experience.minYears ?? '–'}+ yrs, resume ${experience.resumeYears} yrs)`);
    warnings.forEach((w) => console.log(`      warning: ${w}`));
  } catch (err) {
    failed = true;
    console.log(`FAIL  full analysis: ${err.code ?? err.name} – ${err.message} (${Date.now() - t} ms)`);
  }
}

process.exit(failed ? 1 : 0);
