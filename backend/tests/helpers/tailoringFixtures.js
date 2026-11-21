// Fictional analysis used by the Phase 5 tests: the ALEX MORGAN sample resume against the
// "Senior Backend Engineer" sample JD, produced with the real Phase 4 pipeline and a scripted AI.
import fs from 'node:fs';
import { analyzeJobDescription } from '../../services/job-analysis/analyze-job.js';
import { sampleResume } from './fixtures.js';
import { aiAnswer, createFakeAi } from './fakeAi.js';

export const SECTIONED_JD = fs.readFileSync(new URL('../fixtures/job-descriptions/sectioned.txt', import.meta.url), 'utf8');

export const SECTIONED_ANALYSIS_ANSWER = aiAnswer({
  minYears: 5,
  quote: '5+ years of professional software development experience',
  requirements: [
    { term: 'Node.js', category: 'backend' },
    { term: 'TypeScript', category: 'language' },
    { term: 'MongoDB', category: 'database' },
    { term: 'Redis', category: 'database' },
    { term: 'Docker', category: 'devops' },
    { term: 'AWS', category: 'cloud' },
    { term: 'RESTful APIs', category: 'api' },
    { term: 'NestJS', category: 'backend', importance: 'preferred' },
    { term: 'AWS Lambda', category: 'cloud', importance: 'preferred' },
    { term: 'Kubernetes', category: 'devops', importance: 'preferred' },
    { term: 'GraphQL', category: 'api', importance: 'preferred' },
  ],
  responsibilities: [
    { text: 'Design, build and maintain scalable RESTful APIs in Node.js.', classification: 'EXPERIENCE_SUPPORTED', evidenceIds: ['exp.1.1'] },
    { text: 'Own background job processing and queue-based workflows.', classification: 'EXPERIENCE_SUPPORTED', evidenceIds: ['exp.1.2'] },
  ],
});

export async function sampleAnalysis(resume = sampleResume) {
  const result = await analyzeJobDescription({ jobTitle: 'Senior Backend Engineer', jobDescription: SECTIONED_JD, resume, ai: createFakeAi({ answer: SECTIONED_ANALYSIS_ANSWER }), today: new Date('2026-11-01') });
  return { jobTitle: 'Senior Backend Engineer', companyName: 'Northwind Labs', ...result };
}

/** A scripted tailoring answer: one good summary, good and bad bullet rewrites. */
export function tailoringAnswer(overrides = {}) {
  return {
    summary: {
      text: 'Full Stack Developer with 4+ years of experience building web applications using Node.js, Express.js, React.js, TypeScript, and PostgreSQL. Experienced in RESTful API design, background job processing, and automated deployments. Works in Agile teams and ships production-ready features end to end.',
      evidenceIds: ['summary.1', 'summary.2', 'summary.3', 'skills.2.3'],
      targetedKeywords: ['RESTful APIs', 'Node.js', 'TypeScript'],
      rationale: 'Uses the job’s “RESTful API” wording, which the resume already evidences.',
    },
    bullets: [
      { id: 'exp.1.1', text: 'Designed and built 30+ RESTful APIs with Node.js and Express.js for order processing and inventory synchronisation.', evidenceIds: ['exp.1.1'], targetedKeywords: ['RESTful APIs', 'Node.js'], rationale: 'Leads with the technologies the job lists first.' },
      { id: 'exp.1.2', text: 'Led background job processing on Redis queues, handling 50,000+ records per run with retries.', evidenceIds: ['exp.1.2'], targetedKeywords: ['Redis'], rationale: 'Emphasises queue experience.' },
      { id: 'exp.1.3', text: 'Reduced average API response time by ~35% with PostgreSQL indexing and query optimisation in NestJS services.', evidenceIds: ['exp.1.3'], targetedKeywords: ['NestJS'], rationale: 'Mentions NestJS.' },
    ],
    ...overrides,
  };
}
