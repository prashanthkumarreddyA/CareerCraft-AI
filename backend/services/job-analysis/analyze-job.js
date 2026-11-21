import { aiAnswerJsonSchema, aiAnswerSchema, buildAnalysisPrompt, SYSTEM_INSTRUCTION } from './analysis-prompt.js';
import { buildResumeEvidence } from './resume-evidence.js';
import { consolidateRequirements, indexResumeMentions, matchExperience, matchRequirement, matchResponsibilities } from './requirement-matcher.js';
import { calculateMatchScore } from './scoring.js';

export const ANALYSIS_VERSION = 'phase4-v1';

const CATEGORY_GROUPS = {
  language: 'languages',
  frontend: 'frontend',
  backend: 'backend',
  framework: 'frameworks',
  database: 'databases',
  cloud: 'cloud',
  devops: 'devops',
  api: 'apis',
  architecture: 'architecture',
  security: 'security',
  testing: 'testing',
  tool: 'tools',
  methodology: 'methodologies',
  other: 'other',
};

const keywordView = (r) => ({ keyword: r.keyword, normalizedName: r.normalizedName, category: r.category, classification: r.classification });

/**
 * Full analysis of one job description against one structured master resume.
 * Sends the JD and redacted resume evidence (no personal details, no PDF) to the AI provider,
 * then verifies and scores everything deterministically.
 */
export async function analyzeJobDescription({ jobTitle, jobDescription, resume, ai, today = new Date() }) {
  const evidence = buildResumeEvidence(resume, { today });

  const aiResult = await ai.generateJson({
    task: 'job-analysis',
    systemInstruction: SYSTEM_INSTRUCTION,
    prompt: buildAnalysisPrompt({ jobTitle, jobDescription, evidenceItems: evidence.items }),
    schema: aiAnswerSchema,
    jsonSchema: aiAnswerJsonSchema,
  });
  const answer = aiResult.data;

  const { requirements: consolidated, dropped, merged } = consolidateRequirements(answer.requirements, jobDescription);
  const customEntries = consolidated.filter((r) => r.entry.custom).map((r) => r.entry);
  const ctx = { evidence, mentions: indexResumeMentions(evidence.items, customEntries) };

  const requirements = consolidated.map((req) => matchRequirement(req, ctx));
  const { responsibilities, dropped: droppedResponsibilities } = matchResponsibilities(answer.responsibilities, ctx, jobDescription);
  const experience = matchExperience(answer.requiredExperience, ctx, jobDescription);
  const score = calculateMatchScore({ requirements, responsibilities, experience });

  const byImportance = (importance) => requirements.filter((r) => r.importance === importance).map(keywordView);
  const categories = {};
  for (const r of requirements) (categories[CATEGORY_GROUPS[r.category]] ??= []).push(r.keyword);

  const warnings = [];
  if (dropped) warnings.push(`${dropped} keyword${dropped === 1 ? '' : 's'} suggested by the AI did not appear in the job description and ${dropped === 1 ? 'was' : 'were'} ignored.`);
  if (droppedResponsibilities) warnings.push(`${droppedResponsibilities} responsibilit${droppedResponsibilities === 1 ? 'y' : 'ies'} could not be matched to the job description text and ${droppedResponsibilities === 1 ? 'was' : 'were'} ignored.`);
  if (experience.unverified) warnings.push('The years-of-experience requirement could not be verified in the job description and is not scored.');
  if (!evidence.experienceYears.complete && evidence.experienceYears.months) warnings.push('Some experience dates could not be read; total experience may be underestimated.');
  if (!requirements.length) warnings.push('No technical requirements were found in this job description.');

  return {
    jobAnalysis: {
      roleSummary: answer.roleSummary,
      seniority: answer.seniority,
      requiredExperience: { minYears: experience.minYears, maxYears: experience.maxYears, quote: experience.quote, verified: experience.required },
      education: answer.education,
      categories,
      mustHave: requirements.filter((r) => r.importance === 'must_have').map((r) => r.keyword),
      preferred: requirements.filter((r) => r.importance === 'preferred').map((r) => r.keyword),
      optional: requirements.filter((r) => r.importance === 'optional').map((r) => r.keyword),
      responsibilities: responsibilities.map((r) => r.text),
      softSkills: [...new Set(answer.softSkills.filter(Boolean))],
    },
    keywordAnalysis: {
      mustHave: byImportance('must_have'),
      preferred: byImportance('preferred'),
      optional: byImportance('optional'),
      totals: {
        unique: requirements.length,
        mustHave: requirements.filter((r) => r.importance === 'must_have').length,
        preferred: requirements.filter((r) => r.importance === 'preferred').length,
        optional: requirements.filter((r) => r.importance === 'optional').length,
        duplicatesMerged: merged,
        unverifiedDropped: dropped,
      },
    },
    matchAnalysis: { requirements, responsibilities, experience, score, warnings },
    matchPercentage: score.matchPercentage,
    ai: { provider: aiResult.provider, model: aiResult.model, latencyMs: aiResult.latencyMs, attempts: aiResult.attempts },
  };
}
