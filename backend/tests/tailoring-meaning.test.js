// Phase 5 improvements (regression tests):
//  1. skills explicitly listed in the master resume are DIRECT matches, whatever the JD's phrasing
//  2. the professional identity in the summary is locked
//  3. AI summaries keep the original facts
//  4. meaning changes (built → optimized, implemented → architected, developed → led) never pass silently
// No database, no network; fictional data with the structure of the real master resume.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeAi, aiAnswer } from './helpers/fakeAi.js';
import { realStructureResume, withoutListedSkills } from './helpers/realStructureResume.js';
import { analyzeJobDescription } from '../services/job-analysis/analyze-job.js';
import { knownSkillsInTerm } from '../services/job-analysis/requirement-matcher.js';
import { buildFactSheet } from '../services/tailoring/fact-sheet.js';
import { checkClaim, evidenceScope } from '../services/tailoring/claim-checker.js';
import { actionClassesIn, designationsIn, professionalIdentity } from '../services/tailoring/meaning-checker.js';
import { generateTailoringProposals } from '../services/tailoring/generate-proposals.js';
import { buildTailoringPrompt } from '../services/tailoring/tailoring-prompt.js';

// ------------------------------------------------------------------ 1. skill classification

// JD phrasings seen in real job descriptions. The scripted AI deliberately gets them WRONG
// (related experience via Express.js / AWS EC2): the rules must still decide DIRECT_MATCH.
const PHRASES = [
  ['GraphQL', 'api', 'GraphQL'],
  ['GraphQL APIs', 'api', 'GraphQL'],
  ['NestJS', 'backend', 'NestJS'],
  ['NestJS framework', 'backend', 'NestJS'],
  ['Node.js/NestJS', 'backend', 'NestJS'],
  ['AWS Lambda', 'cloud', 'AWS Lambda'],
  ['AWS Lambda functions', 'cloud', 'AWS Lambda'],
  ['AWS (Lambda, S3)', 'cloud', 'AWS Lambda'],
];

async function analyse(resume, term, category) {
  const jobDescription = `Backend engineer role. Requirements: strong experience with ${term} in production systems, plus clean code and testing habits.`;
  const answer = aiAnswer({
    requirements: [{ term, normalizedName: term, category, classification: 'RELATED_EXPERIENCE', relatedSkill: category === 'cloud' ? 'AWS EC2' : 'Express.js', evidenceIds: ['exp.1.1'] }],
  });
  const result = await analyzeJobDescription({ jobTitle: 'Backend Engineer', jobDescription, resume, ai: createFakeAi({ answer }), today: new Date('2026-11-01') });
  return result.matchAnalysis.requirements;
}

for (const [term, category, skill] of PHRASES) {
  test(`skill listed in the master resume is a direct match: JD “${term}” → ${skill}`, async () => {
    const reqs = await analyse(realStructureResume, term, category);
    const req = reqs.find((r) => r.normalizedName === skill);
    assert.ok(req, `no requirement for ${skill}: ${JSON.stringify(reqs.map((r) => r.normalizedName))}`);
    assert.equal(req.classification, 'DIRECT_MATCH', req.explanation);
    assert.ok(req.evidence.some((e) => e.id.startsWith('skills.')), 'evidence is the skills-list entry');
    assert.ok(reqs.every((r) => r.classification === 'DIRECT_MATCH'), JSON.stringify(reqs.map((r) => [r.keyword, r.classification])));
  });
}

test('NestJS and AWS Lambda removed from the skills list → MISSING (no credit); Express.js, AWS EC2, GraphQL stay direct', async () => {
  const resume = withoutListedSkills(['NestJS', 'AWS Lambda']);
  for (const [term, category, skill, related] of [
    ['NestJS framework', 'backend', 'NestJS', 'Express.js'],
    ['NestJS', 'backend', 'NestJS', 'Express.js'],
    ['AWS Lambda functions', 'cloud', 'AWS Lambda', 'AWS EC2'],
    ['AWS Lambda', 'cloud', 'AWS Lambda', 'AWS EC2'],
  ]) {
    const r = (await analyse(resume, term, category)).find((x) => x.normalizedName === skill);
    assert.equal(r.classification, 'MISSING', `${term}: ${r.classification}`);
    assert.deepEqual(r.evidence, []);
    assert.ok(r.relatedSkills.includes(related), JSON.stringify(r.relatedSkills)); // context only, "not the same skill"
  }
  for (const [term, category, skill] of [['Express.js', 'backend', 'Express.js'], ['AWS EC2', 'cloud', 'AWS EC2'], ['GraphQL APIs', 'api', 'GraphQL']]) {
    const r = (await analyse(resume, term, category)).find((x) => x.normalizedName === skill);
    assert.equal(r.classification, 'DIRECT_MATCH', term);
  }
  // Score: a MISSING requirement earns nothing, even with a related skill in the resume.
  const jobDescription = 'Backend engineer role. Requirements: NestJS and Express.js in production systems, plus clean code and testing habits.';
  const answer = aiAnswer({ requirements: [{ term: 'NestJS', category: 'backend', classification: 'RELATED_EXPERIENCE', relatedSkill: 'Express.js', evidenceIds: ['exp.1.1'] }, { term: 'Express.js', category: 'backend' }] });
  const result = await analyzeJobDescription({ jobTitle: 'Backend Engineer', jobDescription, resume, ai: createFakeAi({ answer }), today: new Date('2026-11-01') });
  assert.equal(result.matchPercentage, 50);

  // Tailoring can never add them: AI summary and bullets are blocked as gap keywords.
  const missingFacts = buildFactSheet(resume, { jobTitle: 'Backend Engineer', matchAnalysis: { requirements: [...(await analyse(resume, 'NestJS', 'backend')), ...(await analyse(resume, 'AWS Lambda', 'cloud'))], responsibilities: [] } });
  const summary = resume.summary.replace('Express.js,', 'Express.js, NestJS,').replace('to AWS EC2', 'to AWS EC2 and AWS Lambda');
  const s = checkClaim({ text: summary, original: resume.summary, target: { type: 'summary' }, evidenceIds: evidenceScope({ type: 'summary' }, missingFacts), author: 'ai' }, missingFacts);
  assert.deepEqual(s.issues.filter((i) => i.code === 'GAP_KEYWORD').map((i) => i.skillId).sort(), ['aws-lambda', 'nestjs']);
  const bullet = resume.experience[0].bullets[0];
  const b = checkClaim({ text: bullet.replace('Express.js', 'NestJS'), original: bullet, target: { type: 'bullet', roleIndex: 0, bulletIndex: 0 }, evidenceIds: ['exp.1.1'], author: 'user' }, missingFacts);
  assert.ok(b.issues.some((i) => i.code === 'GAP_KEYWORD'));
});

test('a more specific requirement is not proven by the general skill (GraphQL ≠ GraphQL subscriptions)', async () => {
  const reqs = await analyse(realStructureResume, 'GraphQL subscriptions', 'api');
  assert.equal(reqs.length, 1);
  assert.notEqual(reqs[0].classification, 'DIRECT_MATCH');
});

test('JD terms are resolved to known skills only when the rest is qualifier words', () => {
  const ids = (t) => knownSkillsInTerm(t).map((p) => p.id);
  assert.deepEqual(ids('NestJS framework'), ['nestjs']);
  assert.deepEqual(ids('Node.js/NestJS'), ['nodejs', 'nestjs']);
  assert.deepEqual(ids('AWS Lambda functions'), ['aws-lambda']);
  assert.deepEqual(ids('AWS (Lambda, S3)'), ['aws-lambda', 'aws-s3']); // the platform is implied by its parts
  assert.deepEqual(ids('GraphQL subscriptions'), []);
  assert.deepEqual(ids('Kafka Streams expertise'), []);
});

// ------------------------------------------------------------------ 2–4. tailoring checks

const analysis = {
  jobTitle: 'Senior Backend Engineer',
  matchAnalysis: { requirements: await analyse(realStructureResume, 'NestJS framework', 'backend'), responsibilities: [] },
};
const facts = buildFactSheet(realStructureResume, analysis);
const SUMMARY = realStructureResume.summary;
const summaryIds = evidenceScope({ type: 'summary' }, facts);
const bullets = realStructureResume.experience[0].bullets;
const byCode = (r, sev) => r.issues.filter((i) => !sev || i.severity === sev).map((i) => i.code);
const aiSummary = (text) => checkClaim({ text, original: SUMMARY, target: { type: 'summary' }, evidenceIds: summaryIds, author: 'ai' }, facts);
const userSummary = (text) => checkClaim({ text, original: SUMMARY, target: { type: 'summary' }, evidenceIds: summaryIds, author: 'user' }, facts);
const aiBullet = (b, text, evidenceIds = [`exp.1.${b + 1}`]) => checkClaim({ text, original: bullets[b], target: { type: 'bullet', roleIndex: 0, bulletIndex: b }, evidenceIds, author: 'ai' }, facts);

test('professional identity comes from the headline: Full Stack Developer', () => {
  assert.equal(professionalIdentity(realStructureResume), 'full stack developer');
  assert.equal(facts.identity, 'full stack developer');
  assert.deepEqual(designationsIn('Backend Developer with 4+ years of experience.'), ['backend developer']);
  // Other people are not designations of the candidate.
  assert.deepEqual(designationsIn('Full Stack Developer who works with frontend developers and a QA engineer.'), ['full stack developer']);
  assert.match(buildTailoringPrompt({ jobTitle: 'Senior Backend Engineer', facts }), /PROFESSIONAL IDENTITY \(locked, keep exactly\): Full Stack Developer/);
});

test('summary: Full Stack Developer cannot become Backend Developer (AI or user)', () => {
  const backend = SUMMARY.replace('Full Stack Developer', 'Backend Developer');
  for (const r of [aiSummary(backend), userSummary(backend)]) {
    assert.equal(r.passed, false);
    assert.ok(byCode(r, 'error').includes('IDENTITY_CHANGED'));
    assert.ok(byCode(r, 'error').includes('DESIGNATION_ADDED'));
  }
  // Moving the identity out of the lead position is also a change.
  const demoted = `Backend specialist and Full Stack Developer${SUMMARY.slice('Full Stack Developer'.length)}`;
  assert.ok(byCode(aiSummary(`Software Engineer and ${SUMMARY}`), 'error').includes('IDENTITY_CHANGED'));
  assert.ok(byCode(aiSummary(demoted), 'error').length > 0);
  // Spelling variants of the same identity are fine; seniority inflation is not.
  assert.equal(aiSummary(SUMMARY.replace('Full Stack Developer', 'Full-Stack Developer')).passed, true);
  assert.ok(byCode(aiSummary(SUMMARY.replace('Full Stack Developer', 'Senior Full Stack Developer')), 'error').includes('INFLATED_ROLE'));
});

test('summary: the AI may not drop important facts to make it shorter', () => {
  const short = 'Full Stack Developer with 4+ years of experience creating customer portals using Node.js, TypeScript, MongoDB, and Redis. Experienced in RESTful APIs, GraphQL, and NestJS.';
  const r = aiSummary(short);
  assert.equal(r.passed, false);
  assert.ok(byCode(r, 'error').includes('SUMMARY_DETAIL_REMOVED'));
  assert.ok(byCode(r, 'error').includes('SUMMARY_TOO_SHORT'));
  assert.match(r.issues.find((i) => i.code === 'SUMMARY_DETAIL_REMOVED').message, /Express\.js/);
  // Rewording + re-ordering that keeps every fact passes; GitHub Actions is used in a job bullet.
  const reordered =
    'Full Stack Developer with 4+ years of experience creating customer portals using Node.js, Express.js, TypeScript, React.js, MongoDB, and MySQL. ' +
    'Focused on server-side work such as RESTful APIs, JWT authentication, and queue-based background jobs on Redis and BullMQ. ' +
    'Experienced in automating CI/CD deployments to AWS EC2 with GitHub Actions. Collaborates in Agile/Scrum squads on customer-facing releases.';
  const ok = aiSummary(reordered);
  assert.equal(ok.passed, true, JSON.stringify(ok.issues));
  assert.equal(ok.needsReview, false);
  // The user's own shorter edit is only warned about (they decide what to keep).
  const mine = userSummary(short);
  assert.equal(mine.passed, true, JSON.stringify(mine.issues));
  assert.ok(byCode(mine, 'warning').includes('REMOVED_DETAIL'));
});

test('meaning: built → developed / implemented is the same action and passes without review', () => {
  const r = aiBullet(1, 'Developed 20+ RESTful APIs with JWT authentication and role-based access for internal tools.');
  assert.equal(r.passed, true, JSON.stringify(r.issues));
  assert.equal(r.needsReview, false);
  assert.deepEqual([...actionClassesIn('Implemented and built').keys()], ['create']);
});

test('meaning: built → optimized is flagged for manual review (never silently approved)', () => {
  const r = aiBullet(1, 'Optimized 20+ RESTful APIs with JWT authentication and role-based access for internal tools.');
  assert.equal(r.passed, true); // no unsupported fact…
  assert.equal(r.needsReview, true); // …but the meaning changed
  assert.deepEqual(byCode(r, 'review'), ['MEANING_CHANGED']);
  assert.match(r.issues.find((i) => i.code === 'MEANING_CHANGED').message, /optimis/);
});

test('meaning: implemented → architected and developed → led are blocked as inflation', () => {
  assert.ok(byCode(aiBullet(2, 'Architected queue-based background jobs on Redis and BullMQ for nightly report generation.'), 'error').includes('INFLATED_ROLE'));
  assert.ok(byCode(aiBullet(0, 'Led order management services with Node.js, Express.js and MongoDB.'), 'error').includes('INFLATED_ROLE'));
});

test('meaning: “led” found elsewhere in the role does not make developed → led safe', () => {
  // exp.1.5 says "Led weekly code reviews": cited, so INFLATED_ROLE cannot fire, but bullet 1 did not lead anything.
  const r = aiBullet(0, 'Led order management services with Node.js, Express.js and MongoDB.', ['exp.1.1', 'exp.1.5']);
  assert.ok(!byCode(r, 'error').includes('INFLATED_ROLE'));
  assert.equal(r.needsReview, true);
  assert.ok(byCode(r, 'review').includes('MEANING_CHANGED'));
});

test('meaning: “contributed to” cannot become sole ownership', () => {
  const r = aiBullet(3, 'Migrated reporting services to AWS EC2 with GitHub Actions pipelines.');
  assert.ok(byCode(r, 'error').includes('OWNERSHIP_INFLATED'), JSON.stringify(r.issues));
});

test('meaning: new outcomes and unknown verbs need review', () => {
  const outcome = aiBullet(2, 'Implemented queue-based background jobs on Redis and BullMQ for nightly report generation, ensuring timely delivery.');
  assert.ok(byCode(outcome, 'review').includes('MEANING_CHANGED'));
  const unknown = aiBullet(2, 'Spearheaded queue-based background jobs on Redis and BullMQ for nightly report generation.');
  assert.ok(byCode(unknown, 'error').includes('INFLATED_ROLE'));
  const unknownVerb = aiBullet(2, 'Wired queue-based background jobs on Redis and BullMQ for nightly report generation.');
  assert.ok(byCode(unknownVerb, 'review').includes('UNVERIFIED_ACTION'));
});

test('generation: an AI summary that changes the identity is blocked, meaning changes are marked for review', async () => {
  const answer = {
    summary: { text: SUMMARY.replace('Full Stack Developer', 'Backend Developer'), evidenceIds: ['summary.1', 'summary.2', 'summary.3'], targetedKeywords: [], rationale: 'Matches the job title.' },
    bullets: [{ id: 'exp.1.2', text: 'Optimized 20+ RESTful APIs with JWT authentication and role-based access for internal tools.', evidenceIds: ['exp.1.2'], targetedKeywords: [], rationale: 'x' }],
  };
  const fake = createFakeAi({ answer: (req) => (req.task === 'tailoring' ? answer : { summary: answer.summary, bullets: [] }) });
  const out = await generateTailoringProposals({ resume: realStructureResume, analysis, ai: fake });
  const blockedSummary = out.blocked.find((b) => b.key === 'summary');
  assert.ok(blockedSummary, 'summary blocked');
  assert.ok(blockedSummary.issues.some((i) => i.code === 'IDENTITY_CHANGED'));
  assert.ok(!out.changes.some((c) => c.changeId === 'summary'));
  const bullet = out.changes.find((c) => c.changeId === 'bullet-1-2');
  assert.equal(bullet.validation.passed, true);
  assert.equal(bullet.validation.needsReview, true);
});

test('summary: a skill that only the skills list names needs review (found in the real-resume run)', () => {
  // "deployments to AWS Lambda": Lambda is listed as a skill, but no job or project shows it in use.
  const r = aiSummary(SUMMARY.replace('deployments to AWS EC2', 'deployments to AWS EC2 and AWS Lambda'));
  assert.equal(r.passed, true, JSON.stringify(r.issues)); // listed skills are real…
  assert.equal(r.needsReview, true); // …but the context must be checked by the user
  assert.match(r.issues.find((i) => i.code === 'SKILL_LIST_ONLY').message, /AWS Lambda/);
  // A skill already in the original summary, or used in a job bullet, needs no review.
  assert.equal(aiSummary(SUMMARY.replace('to AWS EC2', 'to AWS EC2 with GitHub Actions')).needsReview, false);
});
