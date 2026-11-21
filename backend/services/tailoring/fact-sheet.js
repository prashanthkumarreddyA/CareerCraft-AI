import { buildResumeEvidence } from '../job-analysis/resume-evidence.js';
import { indexResumeMentions } from '../job-analysis/requirement-matcher.js';
import { aliasPattern, getEntry } from '../job-analysis/skill-taxonomy.js';
import { designationsIn, normalizeDesignation, professionalIdentity } from './meaning-checker.js';

/**
 * The fact sheet is the ONLY source of truth for tailoring: the master resume (as numbered
 * evidence lines) plus the saved job analysis. Every proposed statement is checked against it.
 */

export const SUPPORTED = new Set(['DIRECT_MATCH', 'EXPERIENCE_SUPPORTED']);
export const GAP = new Set(['RELATED_EXPERIENCE', 'MISSING']);

/** Search entries for JD keywords the taxonomy does not know (same spelling rules as Phase 4). */
export function jdKeywordEntries(requirements) {
  return requirements
    .filter((r) => String(r.id).startsWith('custom:'))
    .map((r) => {
      const spellings = [...new Set([r.keyword, ...(r.variants ?? []), r.normalizedName].filter((s) => s && s.trim().length >= 2).map((s) => s.trim()))];
      return {
        id: r.id,
        name: r.normalizedName || r.keyword,
        category: r.category,
        custom: true,
        patterns: spellings.map((s) => aliasPattern(s.length <= 3 ? `=${s}` : s)),
      };
    });
}

/** Skills/technologies named in a piece of text (taxonomy + this JD's own keywords). */
export function mentionsIn(text, customEntries) {
  return indexResumeMentions([{ id: 'text', text: String(text ?? '') }], customEntries).get('text');
}

export const skillName = (id, customEntries = []) => getEntry(id)?.name ?? customEntries.find((e) => e.id === id)?.name ?? id;

export function buildFactSheet(resume, analysis, { today } = {}) {
  const evidence = buildResumeEvidence(resume, { today });
  const requirements = analysis.matchAnalysis.requirements;
  const customEntries = jdKeywordEntries(requirements);
  const mentions = indexResumeMentions(evidence.items, customEntries);

  const supported = requirements.filter((r) => SUPPORTED.has(r.classification));
  const gaps = requirements.filter((r) => GAP.has(r.classification));
  const supportedResponsibilityEvidence = new Set(
    (analysis.matchAnalysis.responsibilities ?? []).filter((r) => SUPPORTED.has(r.classification)).flatMap((r) => r.evidence.map((e) => e.id)),
  );

  // Locked professional identity ("Full Stack Developer") and the designations the resume itself uses.
  const identity = professionalIdentity(resume);
  const allowedDesignations = [
    ...new Set([
      identity,
      ...designationsIn(resume.headline),
      ...designationsIn(resume.summary),
      ...resume.experience.flatMap((role) => [normalizeDesignation(role.title), ...designationsIn(role.title)]),
    ].filter(Boolean)),
  ];

  // Skills the resume shows being USED (experience, projects, achievements), not only listed.
  const practicedSkills = new Set(
    evidence.items.filter((i) => ['experience', 'projects', 'achievements'].includes(i.section)).flatMap((i) => [...(mentions.get(i.id) ?? [])]),
  );

  return {
    resume,
    practicedSkills,
    identity,
    allowedDesignations,
    evidence,
    mentions, // evidence id -> Set(skill id)
    customEntries,
    requirements,
    supported,
    gaps,
    gapIds: new Set(gaps.map((g) => g.id)),
    supportedResponsibilityEvidence,
    roleCount: resume.experience.length,
  };
}
