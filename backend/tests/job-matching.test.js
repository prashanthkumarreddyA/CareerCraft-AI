// Unit tests for the deterministic matching layer (no database, no network).
// Resume data is the fictional ALEX MORGAN fixture; job descriptions are fictional fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sampleResume } from './helpers/fixtures.js';
import { aiAnswer, createFakeAi } from './helpers/fakeAi.js';
import { analyzeJobDescription } from '../services/job-analysis/analyze-job.js';
import { lookupSkill, relationBetween, provesSkill, aliasPattern } from '../services/job-analysis/skill-taxonomy.js';
import { buildResumeEvidence, computeExperienceYears, createRedactor } from '../services/job-analysis/resume-evidence.js';
import { calculateMatchScore, GROUP_WEIGHTS } from '../services/job-analysis/scoring.js';
import { yearsStatedIn } from '../services/job-analysis/requirement-matcher.js';
import { aiAnswerJsonSchema } from '../services/job-analysis/analysis-prompt.js';

const jd = (name) => fs.readFileSync(new URL(`./fixtures/job-descriptions/${name}`, import.meta.url), 'utf8');
const TODAY = new Date('2026-11-01T00:00:00Z');

async function analyze({ jobDescription, answer, resume = sampleResume }) {
  const ai = createFakeAi({ answer });
  const result = await analyzeJobDescription({ jobTitle: 'Test role', jobDescription, resume, ai, today: TODAY });
  return { result, ai, find: (keyword) => result.matchAnalysis.requirements.find((r) => r.keyword === keyword || r.variants.includes(keyword)) };
}

// ---------------------------------------------------------------- taxonomy
test('synonyms resolve to one technology; different technologies stay different', () => {
  assert.equal(lookupSkill('ReactJS'), lookupSkill('React.js'));
  assert.equal(lookupSkill('Postgres'), lookupSkill('PostgreSQL'));
  assert.equal(lookupSkill('NodeJS'), lookupSkill('Node.js'));
  assert.equal(lookupSkill('ExpressJS'), lookupSkill('Express'));
  assert.equal(lookupSkill('k8s'), lookupSkill('Kubernetes'));
  assert.notEqual(lookupSkill('Express.js'), lookupSkill('NestJS'));
  assert.notEqual(lookupSkill('Next.js'), lookupSkill('NestJS'));
  assert.notEqual(lookupSkill('AWS EC2'), lookupSkill('AWS Lambda'));
  assert.notEqual(lookupSkill('Angular'), lookupSkill('AngularJS'));
  assert.notEqual(lookupSkill('Java'), lookupSkill('JavaScript'));
  assert.notEqual(lookupSkill('MySQL'), lookupSkill('PostgreSQL'));
});

test('word boundaries: Java ≠ JavaScript, C ≠ C#/C++, case-sensitive ambiguous words', () => {
  const matches = (alias, text) => [...text.matchAll(aliasPattern(alias))].map((m) => m[0]);
  assert.deepEqual(matches('Java', 'JavaScript and TypeScript'), []);
  assert.deepEqual(matches('=C', 'C# and C++'), []);
  assert.deepEqual(matches('=Go', 'Go to market, golang'), ['Go']);
  assert.deepEqual(matches('=Express', 'express interest'), []);
  assert.deepEqual(matches('Node.js', 'Node.js/Express.js'), ['Node.js']);
});

test('relations: parents prove children only upwards; related ≠ equivalent; unrelated stays unrelated', () => {
  assert.equal(provesSkill(lookupSkill('AWS EC2'), lookupSkill('AWS')), true); // EC2 is AWS experience
  assert.equal(provesSkill(lookupSkill('AWS'), lookupSkill('AWS Lambda')), false); // AWS is not Lambda
  assert.equal(provesSkill(lookupSkill('GitHub Actions'), lookupSkill('CI/CD')), true);
  assert.ok(relationBetween(lookupSkill('NestJS'), lookupSkill('Express')));
  assert.ok(relationBetween(lookupSkill('AWS Lambda'), lookupSkill('AWS EC2')));
  assert.equal(relationBetween(lookupSkill('Docker'), lookupSkill('AWS')), null);
  assert.equal(relationBetween(lookupSkill('Docker'), lookupSkill('AWS EC2')), null);
  // A specific service carries its platform's relations: AWS EC2 → AWS ~ Azure (cloud providers).
  assert.ok(relationBetween(lookupSkill('Azure'), lookupSkill('AWS EC2')));
  // …but concept parents do not: Docker → Containerization does not relate to Kubernetes.
  assert.equal(relationBetween(lookupSkill('Kubernetes'), lookupSkill('Docker')), null);
});

// ---------------------------------------------------------------- the user's example rules
test('Docker is never inferred from AWS (even when the AI claims it)', async () => {
  const noDocker = structuredClone(sampleResume);
  noDocker.technicalSkills = noDocker.technicalSkills.map((g) => ({ ...g, items: g.items.filter((i) => i !== 'Docker') }));
  const { find } = await analyze({
    resume: noDocker,
    jobDescription: jd('sectioned.txt'),
    answer: aiAnswer({ requirements: [{ term: 'Docker', category: 'devops', classification: 'EXPERIENCE_SUPPORTED', evidenceIds: ['skills.5.1'], relatedSkill: 'AWS EC2' }] }),
  });
  const docker = find('Docker');
  assert.equal(docker.classification, 'MISSING');
  assert.equal(docker.evidence.length, 0);
  assert.match(docker.adjustments.join(' '), /not named/);
});

test('NestJS is not inferred from Express.js: MISSING, Express.js shown only as context', async () => {
  const { find } = await analyze({
    jobDescription: jd('sectioned.txt'),
    answer: aiAnswer({ requirements: [{ term: 'NestJS', importance: 'preferred', classification: 'DIRECT_MATCH', evidenceIds: ['skills.2.2'] }] }),
  });
  const nest = find('NestJS');
  assert.equal(nest.classification, 'MISSING');
  assert.deepEqual(nest.evidence, []); // nothing proves NestJS
  assert.deepEqual(nest.relatedSkills, ['Express.js']);
  assert.ok(nest.relatedEvidence.some((e) => e.text.includes('Express.js')));
  assert.match(nest.explanation, /not the same skill, so it earns no credit/);
  assert.equal(find('Express.js')?.classification ?? 'DIRECT_MATCH', 'DIRECT_MATCH');
});

test('AWS Lambda is not inferred from AWS EC2: MISSING, EC2 shown only as context', async () => {
  const { find } = await analyze({
    jobDescription: jd('sectioned.txt'),
    answer: aiAnswer({ requirements: [{ term: 'AWS Lambda', category: 'cloud', importance: 'preferred', classification: 'EXPERIENCE_SUPPORTED', evidenceIds: ['skills.5.1'] }] }),
  });
  assert.equal(find('AWS Lambda').classification, 'MISSING');
  assert.deepEqual(find('AWS Lambda').relatedSkills, ['AWS EC2']);
});

test('the example JD: direct matches, related skills and missing skills are separated', async () => {
  const req = (term, category, importance = 'must_have') => ({ term, category, importance });
  const { find, result } = await analyze({
    jobDescription: jd('sectioned.txt'),
    answer: aiAnswer({
      requirements: [
        req('React.js', 'frontend'),
        req('Node.js', 'backend'),
        req('TypeScript', 'language'),
        req('MongoDB', 'database'),
        req('Docker', 'devops'),
        req('AWS', 'cloud'),
        req('Redis', 'database'),
        req('Kubernetes', 'devops', 'preferred'),
        req('GraphQL', 'api', 'preferred'),
      ],
    }),
  });
  for (const k of ['React.js', 'Node.js', 'TypeScript', 'MongoDB', 'Docker', 'AWS', 'Redis']) assert.equal(find(k).classification, 'DIRECT_MATCH', k);
  assert.ok(find('AWS').evidence.some((e) => e.text === 'AWS EC2')); // AWS proven by the more specific AWS EC2
  assert.equal(find('Kubernetes').classification, 'MISSING'); // not inferred from Docker
  assert.equal(find('GraphQL').classification, 'MISSING'); // REST APIs are related, not the same skill
  assert.ok(find('GraphQL').relatedSkills.length > 0);
  // Every non-missing classification carries resume evidence.
  for (const r of result.matchAnalysis.requirements) {
    if (r.classification !== 'MISSING') assert.ok(r.evidence.length > 0, `${r.keyword} has no evidence`);
  }
});

// ---------------------------------------------------------------- extraction post-processing
test('duplicate keywords and synonym spellings are merged; JD terminology is preserved', async () => {
  const { result, find } = await analyze({
    jobDescription: jd('synonyms-duplicates.md'),
    answer: aiAnswer({
      requirements: [
        { term: 'ReactJS', category: 'frontend' },
        { term: 'React.js', category: 'frontend', importance: 'preferred' },
        { term: 'NodeJS', category: 'backend', importance: 'preferred' },
        { term: 'Node.js', category: 'backend' },
        { term: 'Postgres', category: 'database' },
        { term: 'PostgreSQL', category: 'database' },
        { term: 'JS', category: 'language' },
        { term: 'Express', category: 'backend' },
        { term: 'ExpressJS', category: 'backend' },
        { term: 'Golang', normalizedName: 'Go', category: 'language', importance: 'preferred' },
      ],
    }),
  });
  const keywords = result.matchAnalysis.requirements.map((r) => r.keyword);
  assert.deepEqual(keywords, ['ReactJS', 'NodeJS', 'Postgres', 'JS', 'Express', 'Golang']);
  assert.equal(result.keywordAnalysis.totals.duplicatesMerged, 4);
  assert.deepEqual(find('ReactJS').variants, ['ReactJS', 'React.js']);
  assert.equal(find('NodeJS').importance, 'must_have'); // highest importance wins on merge
  for (const k of ['ReactJS', 'NodeJS', 'Postgres', 'JS', 'Express']) assert.equal(find(k).classification, 'DIRECT_MATCH', k);
  assert.equal(find('Golang').classification, 'MISSING');
});

test('keywords that do not appear in the job description are dropped (AI inventions)', async () => {
  const { result } = await analyze({
    jobDescription: jd('plain-paragraph.txt'),
    answer: aiAnswer({ requirements: [{ term: 'React', category: 'frontend' }, { term: 'Svelte', category: 'frontend' }, { term: 'Kubernetes', category: 'devops' }] }),
  });
  assert.deepEqual(result.matchAnalysis.requirements.map((r) => r.keyword), ['React']);
  assert.equal(result.keywordAnalysis.totals.unverifiedDropped, 2);
  assert.match(result.matchAnalysis.warnings.join(' '), /did not appear/);
});

test('unsupported skills: unknown technologies are missing; a cited same-category skill is context only', async () => {
  const { find } = await analyze({
    jobDescription: jd('unsupported-skills.txt'),
    answer: aiAnswer({
      requirements: [
        { term: 'Apache Spark', category: 'framework' },
        { term: 'Airflow', category: 'tool', classification: 'RELATED_EXPERIENCE', evidenceIds: ['skills.5.2'], relatedSkill: 'Docker' }, // devops ≠ tool
        { term: 'Snowflake', category: 'database', importance: 'preferred', classification: 'RELATED_EXPERIENCE', evidenceIds: ['skills.4.1'], relatedSkill: 'PostgreSQL' },
        { term: 'Scala', category: 'language', classification: 'EXPERIENCE_SUPPORTED', evidenceIds: ['skills.1.1'] },
      ],
    }),
  });
  assert.equal(find('Apache Spark').classification, 'MISSING');
  assert.equal(find('Airflow').classification, 'MISSING');
  assert.equal(find('Snowflake').classification, 'MISSING');
  assert.deepEqual(find('Snowflake').relatedSkills, ['PostgreSQL']);
  assert.equal(find('Snowflake').decidedBy, 'ai+rules');
  assert.equal(find('Scala').classification, 'MISSING');
});

test('concepts: AI experience support needs real evidence ids; AI "direct" for unnamed concepts is downgraded', async () => {
  const { find } = await analyze({
    jobDescription: 'We need someone who can design APIs, apply security best practices, write clean code, own system design and lead code reviews in our team of engineers building products.',
    answer: aiAnswer({
      requirements: [
        { term: 'design APIs', normalizedName: 'API design', category: 'architecture', classification: 'EXPERIENCE_SUPPORTED', evidenceIds: ['exp.1.1'] },
        { term: 'write clean code', normalizedName: 'Clean code', category: 'other', classification: 'DIRECT_MATCH', evidenceIds: ['exp.1.1'] },
        { term: 'security best practices', category: 'security', classification: 'EXPERIENCE_SUPPORTED', evidenceIds: ['exp.9.9', 'made-up'] },
        { term: 'system design', category: 'architecture', classification: 'EXPERIENCE_SUPPORTED', evidenceIds: ['exp.1.2'] },
      ],
    }),
  });
  // The fictional summary literally says "REST API design": the rules find it, so it is direct.
  assert.equal(find('design APIs').classification, 'DIRECT_MATCH');
  assert.equal(find('design APIs').decidedBy, 'rules');
  // Not named anywhere: the AI's "direct" claim becomes experience-supported, with its evidence.
  assert.equal(find('write clean code').classification, 'EXPERIENCE_SUPPORTED');
  assert.match(find('write clean code').adjustments.join(' '), /not named verbatim/);
  assert.equal(find('write clean code').evidence[0].id, 'exp.1.1');
  assert.equal(find('security best practices').classification, 'MISSING');
  assert.equal(find('system design').classification, 'EXPERIENCE_SUPPORTED');
});

test('responsibilities: must come from the JD and be supported by experience, not a skills list', async () => {
  const { result } = await analyze({
    jobDescription: jd('sectioned.txt'),
    answer: aiAnswer({
      responsibilities: [
        { text: 'Design, build and maintain scalable RESTful APIs in Node.js.', classification: 'DIRECT_MATCH', evidenceIds: ['exp.1.1'] },
        { text: 'Own background job processing and queue-based workflows.', classification: 'EXPERIENCE_SUPPORTED', evidenceIds: ['skills.4.3'] },
        { text: 'Manage a team of twelve data scientists across three continents.', classification: 'EXPERIENCE_SUPPORTED', evidenceIds: ['exp.1.1'] },
      ],
    }),
  });
  const [apis, jobs] = result.matchAnalysis.responsibilities;
  assert.equal(result.matchAnalysis.responsibilities.length, 2); // invented responsibility dropped
  assert.equal(apis.classification, 'EXPERIENCE_SUPPORTED'); // never DIRECT for responsibilities
  assert.equal(jobs.classification, 'MISSING'); // skills-list evidence does not prove a responsibility
});

// ---------------------------------------------------------------- experience years
test('experience years: overlapping roles merged, Present resolved, JD requirement verified', () => {
  const years = computeExperienceYears([
    { startDate: 'Jan 2020', endDate: 'Dec 2021' },
    { startDate: 'Jun 2021', endDate: 'Present' },
  ], TODAY);
  assert.equal(years.months, 83); // Jan 2020 – Nov 2026 inclusive, overlap counted once
  assert.equal(years.complete, true);
  assert.equal(computeExperienceYears([{ startDate: 'sometime', endDate: 'Present' }], TODAY).complete, false);
  assert.ok(yearsStatedIn('5+ years of professional experience', 5));
  assert.ok(yearsStatedIn('at least three years of experience', 3));
  assert.ok(yearsStatedIn('3-5 yrs in backend', 3));
  assert.equal(yearsStatedIn('a team of 5 engineers, 10 years old company', 5), false);
});

test('experience requirement is scored only when stated in the JD', async () => {
  const met = await analyze({ jobDescription: jd('sectioned.txt'), answer: aiAnswer({ minYears: 5, quote: '5+ years' }) });
  assert.equal(met.result.matchAnalysis.experience.classification, 'DIRECT_MATCH'); // fixture: Jun 2021 – Present ≈ 5.4 years
  const notStated = await analyze({ jobDescription: jd('sectioned.txt'), answer: aiAnswer({ minYears: 8, quote: '8+ years' }) });
  assert.equal(notStated.result.matchAnalysis.experience.required, false);
  assert.match(notStated.result.matchAnalysis.warnings.join(' '), /could not be verified/);
  const short = await analyze({ jobDescription: jd('unsupported-skills.txt'), answer: aiAnswer({ minYears: 6 }) });
  assert.equal(short.result.matchAnalysis.experience.classification, 'RELATED_EXPERIENCE'); // 5.4 vs 6: within a year
});

// ---------------------------------------------------------------- scoring
test('score formula: weighted group coverage, absent groups re-normalised', () => {
  const r = (classification, importance) => ({ classification, importance, keyword: `${classification}-${importance}` });
  const score = calculateMatchScore({
    requirements: [r('DIRECT_MATCH', 'must_have'), r('MISSING', 'must_have'), r('RELATED_EXPERIENCE', 'preferred')],
    responsibilities: [{ classification: 'EXPERIENCE_SUPPORTED' }],
    experience: { required: true, classification: 'DIRECT_MATCH' },
  });
  // must-have 50 × 0.5, preferred 20 × 0.3, responsibilities 15 × 0.85, experience 10 × 1; optional absent → ÷95
  const expected = Math.round(((50 * 0.5 + 20 * 0.3 + 15 * 0.85 + 10 * 1) / 95) * 100);
  assert.equal(score.matchPercentage, expected);
  assert.equal(score.totalRequirements, 5);
  assert.equal(score.matchedRequirements, 3);
  assert.equal(score.partiallySupportedRequirements, 1);
  assert.equal(score.missingRequirements, 1);
  assert.equal(score.mustHaveCoverage, 50);
  assert.deepEqual(score.mustHaveMissing, ['MISSING-must_have']);
  assert.equal(score.breakdown.find((b) => b.group === 'optional').included, false);
  assert.equal(Object.values(GROUP_WEIGHTS).reduce((a, b) => a + b), 100);
  assert.match(score.disclaimer, /not an ATS score/);
  assert.equal(calculateMatchScore({ requirements: [], responsibilities: [], experience: null }).matchPercentage, 0);
});

// ---------------------------------------------------------------- formats, length, privacy
test('different JD formats and a long description are analysed', async () => {
  for (const name of ['sectioned.txt', 'plain-paragraph.txt', 'synonyms-duplicates.md', 'unsupported-skills.txt']) {
    const { result } = await analyze({ jobDescription: jd(name), answer: aiAnswer() });
    assert.ok(result.matchAnalysis.score, name);
  }
  const long = `${jd('sectioned.txt')}\n${'Our platform team values reliability, observability and clear written communication. '.repeat(210)}`;
  assert.ok(long.length > 18_000);
  const { result, ai } = await analyze({ jobDescription: long, answer: aiAnswer({ requirements: [{ term: 'Node.js' }] }) });
  assert.equal(result.matchAnalysis.requirements[0].classification, 'DIRECT_MATCH');
  assert.ok(ai.requests[0].prompt.includes(long));
});

test('privacy: the AI receives no contact details, names, companies, institutions or locations', async () => {
  const { ai } = await analyze({ jobDescription: jd('sectioned.txt'), answer: aiAnswer() });
  const sent = JSON.stringify(ai.requests[0]);
  const p = sampleResume.personalInfo;
  for (const value of [p.fullName, 'Alex', 'Morgan', p.email, p.phone, p.linkedin, p.github, p.location, 'Example Corp', 'Sample Labs', 'Example Institute']) {
    assert.equal(sent.includes(value), false, `prompt contains ${value}`);
  }
  assert.ok(sent.includes('Designed and built 30+ RESTful APIs')); // professional content is sent
});

test('redaction removes contact details that appear inside free text', () => {
  const redact = createRedactor({ fullName: 'Alex Morgan' });
  const out = redact('Contact Alex at alex@example.com, +1 (555) 010-0200 or https://example.com/alex; built 25+ APIs in 2024');
  assert.equal(out, 'Contact [name] at [email], [phone] or [link]; built 25+ APIs in 2024');
  const items = buildResumeEvidence(sampleResume, { today: TODAY }).items;
  assert.ok(items.every((i) => !/@|linkedin|github\.com/i.test(i.text)));
});

test('the JSON Schema sent to Gemini has no constructs Gemini rejects', () => {
  const text = JSON.stringify(aiAnswerJsonSchema);
  for (const keyword of ['"minimum"', '"maximum"', '"maxItems"', '"$schema"', '"anyOf"']) assert.equal(text.includes(keyword), false, keyword);
});
