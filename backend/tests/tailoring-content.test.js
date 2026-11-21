// CHECKPOINT 1 — content optimisation: claim checker, proposal generation, ordering, coverage.
// No database, no network; fictional resume and job description only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleResume } from './helpers/fixtures.js';
import { createFakeAi } from './helpers/fakeAi.js';
import { sampleAnalysis, tailoringAnswer } from './helpers/tailoringFixtures.js';
import { buildFactSheet } from '../services/tailoring/fact-sheet.js';
import { checkClaim, normalizeText } from '../services/tailoring/claim-checker.js';
import { generateTailoringProposals, isDeletionOnly } from '../services/tailoring/generate-proposals.js';
import { buildContent, keywordCoverage, layoutReport, verifyLockedFields } from '../services/tailoring/content-builder.js';
import { aiError } from '../services/ai/ai-errors.js';
import { tailoringAnswerJsonSchema } from '../services/tailoring/tailoring-prompt.js';

const analysis = await sampleAnalysis();
const facts = buildFactSheet(sampleResume, analysis);
const bullet = (roleIndex, bulletIndex) => ({ type: 'bullet', roleIndex, bulletIndex });
const original = (r, b) => sampleResume.experience[r].bullets[b];
const ai = (text, { target = bullet(0, 0), evidenceIds = ['exp.1.1'] } = {}) =>
  checkClaim({ text, original: target.type === 'bullet' ? original(target.roleIndex, target.bulletIndex) : sampleResume.summary, target, evidenceIds, author: 'ai' }, facts);
const codes = (result) => result.issues.filter((i) => i.severity === 'error').map((i) => i.code);
const SUMMARY = sampleResume.summary;
const SUMMARY_IDS = ['summary.1', 'summary.2', 'summary.3'];

test('fixture sanity: gaps and supported keywords come from the Phase 4 analysis', () => {
  const status = Object.fromEntries(analysis.matchAnalysis.requirements.map((r) => [r.keyword, r.classification]));
  assert.equal(status.NestJS, 'MISSING'); // Express.js is related context only
  assert.equal(status['AWS Lambda'], 'MISSING'); // AWS EC2 is related context only
  assert.equal(status.Kubernetes, 'MISSING');
  assert.equal(status.Docker, 'DIRECT_MATCH');
});

// ------------------------------------------------------------------ claim checker: accepted
test('rewording that keeps every fact passes', () => {
  const r = ai('Designed and built 30+ RESTful APIs with Node.js and Express.js for order processing and inventory synchronisation.');
  assert.equal(r.passed, true, JSON.stringify(r.issues));
});

test('switching to the job’s spelling of the SAME technology passes (Postgres = PostgreSQL)', () => {
  const r = ai('Reduced average API response time by ~35% by adding Postgres indexes and query optimisation.', { target: bullet(0, 2), evidenceIds: ['exp.1.3'] });
  assert.equal(r.passed, true, JSON.stringify(r.issues));
});

test('summary may draw on any section it cites (e.g. Docker from the skills list)', () => {
  const r = ai(SUMMARY.replace('and PostgreSQL', 'PostgreSQL, and Docker'), { target: { type: 'summary' }, evidenceIds: [...SUMMARY_IDS, 'skills.5.2'] });
  assert.equal(r.passed, true, JSON.stringify(r.issues));
});

// ------------------------------------------------------------------ claim checker: blocked
test('related experience never becomes direct: Express.js → NestJS is blocked as a gap', () => {
  const r = ai('Designed and built 30+ RESTful APIs in NestJS for order processing and inventory synchronisation.');
  assert.deepEqual(codes(r), ['GAP_KEYWORD']);
  assert.match(r.issues[0].message, /you have Express\.js, which is related but not the same skill/);
});

test('AWS EC2 does not become AWS Lambda; Kubernetes (missing) cannot be added', () => {
  assert.ok(codes(ai('Built 30+ RESTful APIs on AWS Lambda for order processing.')).includes('GAP_KEYWORD'));
  assert.ok(codes(ai('Built 30+ RESTful APIs in Node.js, deployed on Kubernetes.')).includes('GAP_KEYWORD'));
});

test('a real skill from elsewhere cannot be attributed to a role that does not mention it', () => {
  // Docker is in the skills list, but not in role 1's bullets: adding it to a role 1 bullet is a new claim.
  const r = ai('Designed and built 30+ RESTful APIs in Node.js/Express.js, containerised with Docker.', { evidenceIds: ['exp.1.1', 'skills.5.2'] });
  assert.ok(codes(r).includes('EVIDENCE_OUT_OF_SCOPE'));
  assert.ok(codes(r).includes('UNSUPPORTED_TECHNOLOGY'));
});

test('unknown tools and names are blocked even when the taxonomy does not know them', () => {
  const r = ai('Designed and built 30+ RESTful APIs in Node.js/Express.js with Apache Pulsar event streams.');
  assert.ok(codes(r).includes('UNSUPPORTED_TERM'));
  assert.match(r.issues.find((i) => i.code === 'UNSUPPORTED_TERM').message, /Pulsar/);
});

test('plurals and generic acronyms are not treated as new names (found in live Gemini output)', () => {
  // The summary says "REST API design"; "RESTful APIs design" adds no new tool.
  const r = ai(SUMMARY.replace('REST API design', 'RESTful APIs design'), { target: { type: 'summary' }, evidenceIds: SUMMARY_IDS });
  assert.equal(r.passed, true, JSON.stringify(r.issues));
  assert.ok(codes(ai('Designed and built 30+ RESTful APIs in Node.js/Express.js on Apigee.')).includes('UNSUPPORTED_TERM'));
});

test('metrics: changed, invented or vague quantities are blocked', () => {
  assert.deepEqual(codes(ai('Designed and built 40+ RESTful APIs in Node.js/Express.js for order processing and inventory synchronisation.')), ['UNSUPPORTED_NUMBER']);
  assert.ok(codes(ai('Designed and built 30+ RESTful APIs in Node.js/Express.js with 99.9% availability.')).includes('UNSUPPORTED_NUMBER'));
  assert.ok(codes(ai('Designed and built dozens of RESTful APIs in Node.js/Express.js serving thousands of users.')).includes('UNSUPPORTED_QUANTITY'));
  const years = ai(SUMMARY.replace('4+ years', '7+ years'), { target: { type: 'summary' }, evidenceIds: SUMMARY_IDS });
  assert.ok(codes(years).includes('UNSUPPORTED_NUMBER'));
});

test('metrics keep their meaning: decoration and unit must match the evidence', () => {
  const role1 = ['exp.1.1', 'exp.1.2', 'exp.1.3', 'exp.1.4'];
  // "from 40 to 12 minutes" (bullet 4) does not support "40+ APIs" in bullet 1.
  assert.ok(codes(ai('Designed and built 40+ RESTful APIs in Node.js/Express.js.', { evidenceIds: role1 })).includes('UNSUPPORTED_NUMBER'));
  // Same numbers, different unit.
  assert.ok(codes(ai('Automated CI/CD pipelines with GitHub Actions, cutting deployment time from 40 to 12 hours.', { target: bullet(0, 3), evidenceIds: ['exp.1.4'] })).includes('UNSUPPORTED_NUMBER'));
  assert.ok(codes(ai('Implemented background job processing with Redis queues for 50,000+ users per run.', { target: bullet(0, 1), evidenceIds: ['exp.1.2'] })).includes('UNSUPPORTED_NUMBER'));
  // "~35%" may be written as "about 35%"; "30+" must stay "30+", not "30".
  assert.equal(ai('Cut average API response time by about 35% through PostgreSQL indexes and query optimisation.', { target: bullet(0, 2), evidenceIds: ['exp.1.3'] }).passed, true);
  assert.ok(codes(ai('Designed and built 30 RESTful APIs in Node.js/Express.js.')).includes('UNSUPPORTED_NUMBER'));
});

test('leadership and seniority inflation is blocked', () => {
  for (const text of [
    'Led the design of 30+ RESTful APIs in Node.js/Express.js for order processing and inventory synchronisation.',
    'Architected 30+ RESTful APIs in Node.js/Express.js for order processing and inventory synchronisation.',
    'Expert in building 30+ RESTful APIs in Node.js/Express.js for order processing and inventory synchronisation.',
    'Designed 30+ RESTful APIs in Node.js/Express.js and mentored engineers on order processing.',
  ]) assert.deepEqual(codes(ai(text)), ['INFLATED_ROLE'], text);
});

test('evidence must exist and be cited; unprintable characters are rejected', () => {
  assert.ok(codes(ai('Designed and built 30+ RESTful APIs in Node.js/Express.js.', { evidenceIds: ['exp.9.9'] })).includes('UNKNOWN_EVIDENCE'));
  assert.ok(codes(ai('Full Stack Developer building web applications.', { target: { type: 'summary' }, evidenceIds: [] })).includes('EVIDENCE_REQUIRED'));
  assert.ok(codes(ai('Designed and built 30+ RESTful APIs ✓ in Node.js/Express.js.')).includes('UNSUPPORTED_CHARACTER'));
  assert.ok(codes(ai('')).includes('EMPTY_TEXT'));
});

test('dropping details or growing much longer only produces warnings', () => {
  const r = ai('Designed and built RESTful APIs for order processing.');
  assert.equal(r.passed, true);
  assert.ok(r.issues.some((i) => i.code === 'REMOVED_DETAIL' && /30\+?|Express/.test(i.message)));
  const long = ai(`${original(0, 0)} The APIs handled order processing and inventory synchronisation for order processing and inventory synchronisation.`);
  assert.ok(long.issues.some((i) => i.code === 'LENGTH_GROWTH'));
});

test('typography is normalised to printable characters', () => {
  assert.equal(normalizeText('“Built” the team’s APIs  '), '"Built" the team\'s APIs');
});

// ------------------------------------------------------------------ generation
test('generation keeps passing proposals, repairs or blocks failing ones, and never offers a blocked claim', async () => {
  const fake = createFakeAi();
  let call = 0;
  fake.respondWith((request) => {
    call += 1;
    if (call === 1) return tailoringAnswer();
    // Repair round: fixes the inflated bullet, repeats the NestJS one.
    assert.match(request.prompt, /REVISION REQUEST/);
    assert.match(request.prompt, /exp\.1\.2/);
    return {
      summary: null,
      bullets: [
        { id: 'exp.1.2', text: 'Implemented background job processing on Redis queues, handling 50,000+ records per run with retries.', evidenceIds: ['exp.1.2'], targetedKeywords: ['Redis'], rationale: 'Leads with Redis.' },
        { id: 'exp.1.3', text: 'Reduced API response time by ~35% in NestJS services.', evidenceIds: ['exp.1.3'], targetedKeywords: [], rationale: 'x' },
      ],
    };
  });
  const result = await generateTailoringProposals({ resume: sampleResume, analysis, ai: fake });
  const ids = result.changes.map((c) => c.changeId);
  assert.ok(ids.includes('summary'));
  assert.ok(ids.includes('bullet-1-1'));
  assert.ok(ids.includes('bullet-1-2')); // repaired
  assert.ok(!ids.includes('bullet-1-3')); // still claims NestJS → blocked
  assert.deepEqual(result.blocked.map((b) => b.key), ['bullet-1-3']);
  assert.equal(result.blocked[0].issues[0].code, 'GAP_KEYWORD');
  assert.equal(result.ai.repairRound, true);
  for (const c of result.changes) assert.equal(c.validation.passed, true, c.changeId);
  const b11 = result.changes.find((c) => c.changeId === 'bullet-1-1');
  assert.equal(b11.evidence[0].id, 'exp.1.1'); // own bullet is always evidence
  assert.deepEqual(b11.targetedKeywords, ['RESTful APIs', 'Node.js']);
  assert.ok(result.gaps.some((g) => g.keyword === 'NestJS' && g.relatedSkills.includes('Express.js')));
});

test('generation sends no personal details and lists the gaps as forbidden', async () => {
  const fake = createFakeAi();
  fake.respondWith({ summary: null, bullets: [] });
  await generateTailoringProposals({ resume: sampleResume, analysis, ai: fake });
  const sent = JSON.stringify(fake.requests[0]);
  const p = sampleResume.personalInfo;
  for (const v of [p.fullName, p.email, p.phone, p.linkedin, p.github, p.location, 'Example Corp', 'Sample Labs', 'Example Institute']) assert.equal(sent.includes(v), false, v);
  assert.match(fake.requests[0].prompt, /GAPS \(never add these\):[\s\S]*NestJS[\s\S]*Kubernetes/);
});

test('an AI failure propagates (no version is created); a failing repair call keeps valid proposals', async () => {
  const failing = createFakeAi();
  failing.respondWith(aiError('UNAVAILABLE'));
  await assert.rejects(generateTailoringProposals({ resume: sampleResume, analysis, ai: failing }), { code: 'AI_UNAVAILABLE' });

  const flaky = createFakeAi();
  let call = 0;
  flaky.respondWith(() => (++call === 1 ? tailoringAnswer() : aiError('TIMEOUT')));
  const result = await generateTailoringProposals({ resume: sampleResume, analysis, ai: flaky });
  assert.ok(result.changes.some((c) => c.changeId === 'bullet-1-1'));
  assert.deepEqual(result.blocked.map((b) => b.key).sort(), ['bullet-1-2', 'bullet-1-3']);
});

test('AI output that breaks the schema is rejected', async () => {
  const fake = createFakeAi();
  fake.respondWith({ summary: 'just a string', bullets: 'nope' });
  await assert.rejects(generateTailoringProposals({ resume: sampleResume, analysis, ai: fake }), { code: 'AI_INVALID_RESPONSE' });
  assert.equal(JSON.stringify(tailoringAnswerJsonSchema).includes('maxItems'), false);
});

test('deletion-only rewrites (seen with the real resume: "AWS EC2" → "AWS") are not offered', async () => {
  assert.equal(isDeletionOnly('Deployed and maintained applications on AWS EC2.', 'Deployed and maintained applications on AWS.'), true);
  assert.equal(isDeletionOnly(original(0, 0), 'Designed and built 30+ RESTful APIs in Node.js for order processing and inventory synchronisation.'), true);
  assert.equal(isDeletionOnly(original(0, 0), 'Built 30+ RESTful APIs with Node.js and Express.js for order processing and inventory synchronisation.'), false);
  const fake = createFakeAi();
  fake.respondWith({ summary: null, bullets: [{ id: 'exp.1.1', text: 'Designed and built 30+ RESTful APIs in Node.js for order processing and inventory synchronisation.', evidenceIds: ['exp.1.1'], targetedKeywords: ['Node.js'], rationale: 'Shorter.' }] });
  const result = await generateTailoringProposals({ resume: sampleResume, analysis, ai: fake });
  assert.equal(result.changes.some((c) => c.changeId === 'bullet-1-1'), false);
});

test('proposals that target non-bullets, duplicates or unchanged text are ignored', async () => {
  const fake = createFakeAi();
  fake.respondWith({
    summary: { text: sampleResume.summary, evidenceIds: ['summary.1'], targetedKeywords: [], rationale: 'same' },
    bullets: [
      { id: 'proj.1.1', text: 'Changed project bullet', evidenceIds: ['proj.1.1'], targetedKeywords: [], rationale: 'x' },
      { id: 'exp.7.1', text: 'No such role', evidenceIds: [], targetedKeywords: [], rationale: 'x' },
      { id: 'exp.1.4', text: original(0, 3), evidenceIds: ['exp.1.4'], targetedKeywords: [], rationale: 'same' },
    ],
  });
  const result = await generateTailoringProposals({ resume: sampleResume, analysis, ai: fake });
  assert.deepEqual(result.changes.filter((c) => c.type === 'summary' || c.type === 'bullet'), []);
  assert.deepEqual(result.blocked, []);
});

// ------------------------------------------------------------------ ordering, locked fields, coverage
test('skills and bullets are re-ordered deterministically, without adding or removing anything', async () => {
  const fake = createFakeAi();
  fake.respondWith({ summary: null, bullets: [] });
  const { changes } = await generateTailoringProposals({ resume: sampleResume, analysis, ai: fake });
  const skills = changes.find((c) => c.type === 'skills_order');
  assert.ok(skills, 'skills order proposed');
  assert.deepEqual(skills.proposed.flatMap((g) => g.items).sort(), sampleResume.technicalSkills.flatMap((g) => g.items).sort());
  // Backend (Node.js, RESTful APIs) and Databases (MongoDB, Redis) tie on relevance; ties keep the original order.
  assert.deepEqual(skills.proposed.map((g) => g.category), ['Backend', 'Databases', 'Cloud & DevOps', 'Languages', 'Frontend']);
  assert.deepEqual(skills.proposed[1].items, ['MongoDB', 'Redis', 'PostgreSQL']); // matched first, then original order
  const content = buildContent(sampleResume, changes.map((c) => ({ ...c, decision: 'accepted' })));
  assert.deepEqual(verifyLockedFields(sampleResume, content), []);
});

test('locked fields: any change outside the allowed areas is detected', () => {
  const tampered = structuredClone(sampleResume);
  tampered.experience[0].company = 'Other Corp';
  tampered.technicalSkills[0].items.push('Kubernetes');
  tampered.experience[1].bullets.pop();
  tampered.headline = 'Principal Engineer';
  const problems = verifyLockedFields(sampleResume, tampered);
  assert.equal(problems.length, 4, problems.join(' | '));
});

test('keyword coverage: literal wording can improve, evidence-based matches and gaps never change', async () => {
  const fake = createFakeAi();
  fake.respondWith(tailoringAnswer({ bullets: [] }));
  const { changes } = await generateTailoringProposals({ resume: sampleResume, analysis, ai: fake });
  const content = buildContent(sampleResume, changes.map((c) => ({ ...c, decision: 'accepted' })));
  const coverage = keywordCoverage(sampleResume, content, analysis.matchAnalysis.requirements);
  assert.ok(coverage.literalAfter >= coverage.literalBefore);
  assert.deepEqual(coverage.gapsUnchanged.sort(), ['AWS Lambda', 'GraphQL', 'Kubernetes', 'NestJS']);
  assert.ok(coverage.items.filter((i) => !i.supported).every((i) => !i.after)); // no gap appears in the text
});

test('layout report: re-ordering alone never reports growth (found with the real resume)', () => {
  const reordered = structuredClone(sampleResume);
  reordered.experience[0].bullets.reverse();
  assert.deepEqual(layoutReport(sampleResume, reordered, []).grownParagraphs, []);
});

test('layout report: page budget and bullet growth are measured with the Phase 1 engine', () => {
  const longer = structuredClone(sampleResume);
  longer.experience[0].bullets[0] = `${longer.experience[0].bullets[0]} Additional words that make this bullet wrap onto a further line of text, and then a few more words to be sure it wraps.`;
  const report = layoutReport(sampleResume, longer, [{ original: sampleResume.experience[0].bullets[0], text: longer.experience[0].bullets[0] }]);
  assert.equal(report.passed, true);
  assert.equal(report.grownParagraphs.length, 1);
  assert.ok(report.grownParagraphs[0].linesAfter > report.grownParagraphs[0].linesBefore);

  const huge = structuredClone(sampleResume);
  huge.experience.forEach((role) => (role.bullets = role.bullets.map((b) => `${b} ${'Padding text to force extra lines. '.repeat(25)}`)));
  const tooLong = layoutReport(sampleResume, huge);
  assert.equal(tooLong.passed, false);
  assert.match(tooLong.errors.join(' '), /pages; the maximum is 2/);
});
