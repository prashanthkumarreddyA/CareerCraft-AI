import { provesSkill } from '../job-analysis/skill-taxonomy.js';
import { mentionsIn, skillName } from './fact-sheet.js';
import { unsupportedCharacters } from './resume-renderer.js';
import { checkIdentity, checkMeaning } from './meaning-checker.js';

/**
 * Claim checker: decides whether a proposed sentence says only what the cited resume evidence
 * already says. Errors block AI proposals outright; for the user's own edits they require an
 * explicit, recorded override. Warnings are informational.
 *
 * Rules (each produces an issue code):
 *  EMPTY_TEXT / TEXT_TOO_LONG / MULTILINE      basic shape
 *  UNSUPPORTED_CHARACTER                       a glyph the embedded fonts cannot draw
 *  EVIDENCE_REQUIRED / UNKNOWN_EVIDENCE        AI must cite real evidence ids
 *  EVIDENCE_OUT_OF_SCOPE                       a bullet may only use its own role's evidence
 *  GAP_KEYWORD                                 a missing/related JD keyword was added
 *  UNSUPPORTED_TECHNOLOGY                      a technology not named in the cited evidence
 *  UNSUPPORTED_TERM                            a name/acronym the taxonomy does not know and the evidence lacks
 *  UNSUPPORTED_NUMBER / UNSUPPORTED_QUANTITY   a metric, count or year not in the evidence
 *  INFLATED_ROLE                               leadership/seniority wording not in the evidence
 *  IDENTITY_CHANGED / DESIGNATION_ADDED       summary: the locked professional identity (meaning-checker.js)
 *  OWNERSHIP_INFLATED                          "contributed to" became sole ownership (meaning-checker.js)
 *  SUMMARY_DETAIL_REMOVED / SUMMARY_TOO_SHORT  AI summary drops facts of the original summary
 *  MEANING_CHANGED / UNVERIFIED_ACTION (review) a different kind of work, or a verb the checker
 *                                              cannot compare: needs the user's explicit review
 *  SKILL_LIST_ONLY (review)                    summary adds a skill no job or project shows being used
 *  REMOVED_DETAIL / ACTION_REMOVED (warning)   a number, technology or action from the original was dropped
 *  LENGTH_GROWTH / MUCH_SHORTER (warning)      noticeably longer or shorter than the original
 *
 * Severities: "error" blocks (AI) or needs a recorded override (user edits, where allowed);
 * "review" never passes silently: accepting needs an explicit, recorded confirmation;
 * "warning" is informational.
 */

export const LIMITS = { bullet: 420, summary: 1100 };
/** An AI summary may not be shorter than this share of the original (facts must survive). */
export const SUMMARY_MIN_RATIO = 0.8;

/** Typography normalisation applied to all proposed/edited text. */
export function normalizeText(text) {
  return String(text ?? '')
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[     ]/g, ' ')
    .replace(/[​-‍﻿]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// A number keeps its decoration: "40", "40+", "40%" and "40x" are different claims
// ("from 40 to 12 minutes" does not support "40+ APIs").
const NUMBER = /(?<![\w.])~?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(\+|%|x\b)?(?![\d])/g;
const UNIT = /^(years?|yrs?|months?|weeks?|days?|hours?|minutes?|seconds?|ms|records?|users?|customers?|clients?|requests?|transactions?|engineers?|developers?|people|members?|teams?|projects?|services?|apis?|endpoints?|countries|languages?|deployments?|releases?)\b/i;
const QUANTITY_WORDS = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|dozens?|hundreds|thousands|millions|billions|several|numerous|countless)\b/gi;

const numberKey = (m) => `${m[1].replace(/,/g, '').replace(/\.0+$/, '')}${m[2] ?? ''}`;
export const numbersIn = (text) => new Set([...String(text).matchAll(NUMBER)].map(numberKey));

/** Number + unit pairs ("12 minutes", "50000+ records"): the unit must match too. */
export function numberUnitsIn(text) {
  const out = new Set();
  const s = String(text);
  for (const m of s.matchAll(NUMBER)) {
    const rest = s.slice(m.index + m[0].length).replace(/^[\s-]+/, '');
    // allow one qualifier word between number and unit ("30+ RESTful APIs", "4 production services")
    const unit = UNIT.exec(rest) ?? UNIT.exec(rest.replace(/^[A-Za-z.]+\s+/, ''));
    if (unit) out.add(`${numberKey(m)} ${unit[1].toLowerCase().replace(/s$/, '')}`);
  }
  return out;
}
export const quantityWordsIn = (text) => new Set([...String(text).matchAll(QUANTITY_WORDS)].map((m) => m[1].toLowerCase().replace(/s$/, '')));

// Leadership/seniority claims. Each stem must already appear in the evidence to be used.
const ROLE_CLAIMS = [
  ['lead', /\b(lead|leads|leading|led)\b/i],
  ['manage', /\b(manage|manages|managed|managing|manager|managers)\b/i],
  ['own', /\b(own|owns|owned|owning|owner|ownership)\b/i],
  ['architect', /\b(architect|architects|architected|architecting)\b/i],
  ['spearhead', /\bspearhead(s|ed|ing)?\b/i],
  ['head', /\b(headed|heading up|head of)\b/i],
  ['direct', /\b(directed|directing|director)\b/i],
  ['mentor', /\b(mentor|mentors|mentored|mentoring)\b/i],
  ['supervise', /\b(supervise|supervised|supervising|supervisor)\b/i],
  ['oversee', /\b(oversee|oversees|oversaw|overseeing)\b/i],
  ['expert', /\b(expert|experts|expertise)\b/i],
  ['senior', /\bsenior\b/i],
  ['principal', /\bprincipal\b/i],
  ['chief', /\bchief\b/i],
  ['founded', /\b(founded|co-founded|founder)\b/i],
];
export const roleClaimsIn = (text) => new Set(ROLE_CLAIMS.filter(([, re]) => re.test(text)).map(([stem]) => stem));

const issue = (code, message, severity = 'error') => ({ code, message, severity });

// Generic acronyms describe kinds of work, not specific tools or employers.
const GENERIC_ACRONYMS = new Set(['api', 'ui', 'ux', 'csv', 'json', 'xml', 'pdf', 'url', 'http', 'https', 'sdk', 'cli', 'qa', 'kpi', 'mvp', 'crud', 'saas', 'b2b', 'b2c', 'it', 'id']);

/**
 * Proper-noun / technical tokens: contain an inner capital, digit, ".", "+" or "#", or start
 * with a capital somewhere other than the start of a sentence. Plain English words are ignored.
 */
export function termsIn(text) {
  const terms = [];
  const tokens = String(text).split(/[\s/,;:()]+/);
  tokens.forEach((raw, i) => {
    const token = raw.replace(/^[^A-Za-z0-9.#+]+|[^A-Za-z0-9+#]+$/g, '');
    if (!token || /^\d/.test(token)) return; // numbers are checked separately
    for (const part of token.split(/-(?=[a-z])/)) {
      // "Node.js-based" → "Node.js"; "event-driven" stays one word
      const sentenceStart = i === 0 || /[.!?]$/.test(tokens[i - 1] ?? '');
      const technical = /[A-Z]/.test(part.slice(1)) || /[0-9.+#]/.test(part);
      const capitalised = /^[A-Z]/.test(part) && !sentenceStart;
      if ((technical || capitalised) && /[A-Za-z]/.test(part)) terms.push(part);
      break; // only the head of a hyphenated compound can be a name
    }
  });
  return terms;
}

/** Evidence ids a statement may cite. Bullets: only their own role. Summary: the whole resume. */
export function evidenceScope(target, facts) {
  if (target.type === 'bullet') {
    const prefix = `exp.${target.roleIndex + 1}.`;
    return facts.evidence.items.filter((i) => i.id.startsWith(prefix)).map((i) => i.id);
  }
  return facts.evidence.items.map((i) => i.id);
}

/**
 * @param {object} p
 * @param {string} p.text           proposed (normalised) text
 * @param {string} p.original       the original text being replaced
 * @param {{type:'summary'|'bullet', roleIndex?, bulletIndex?}} p.target
 * @param {string[]} p.evidenceIds  cited evidence (AI) or, for user edits, the full allowed scope
 * @param {'ai'|'user'} p.author
 * @param {object} facts            fact sheet
 * @returns {{ passed: boolean, issues: Array<{code,message,severity}> }}
 */
export function checkClaim({ text, original, target, evidenceIds, author }, facts) {
  const issues = [];
  const limit = LIMITS[target.type];
  if (!text) issues.push(issue('EMPTY_TEXT', 'The text is empty.'));
  if (text.length > limit) issues.push(issue('TEXT_TOO_LONG', `The text is longer than ${limit} characters.`));
  if (/[\r\n]/.test(text)) issues.push(issue('MULTILINE', 'The text must be a single paragraph.'));
  const badChars = unsupportedCharacters(text);
  if (badChars.length) issues.push(issue('UNSUPPORTED_CHARACTER', `These characters cannot be printed with the resume font: ${badChars.join(' ')}`));

  // Evidence: existing ids, inside the allowed scope. A bullet always includes its own original.
  const scope = new Set(evidenceScope(target, facts));
  const cited = [...new Set(evidenceIds ?? [])];
  const unknown = cited.filter((id) => !facts.evidence.byId.has(id));
  const outOfScope = cited.filter((id) => facts.evidence.byId.has(id) && !scope.has(id));
  if (author === 'ai' && unknown.length) issues.push(issue('UNKNOWN_EVIDENCE', `Cited evidence does not exist: ${unknown.join(', ')}.`));
  if (outOfScope.length) issues.push(issue('EVIDENCE_OUT_OF_SCOPE', `A bullet can only use facts from its own role; ${outOfScope.join(', ')} belong elsewhere.`));
  const usable = cited.filter((id) => scope.has(id));
  if (target.type === 'bullet') usable.push(`exp.${target.roleIndex + 1}.${target.bulletIndex + 1}`);
  const evidenceItems = [...new Set(usable)].map((id) => facts.evidence.byId.get(id)).filter(Boolean);
  if (!evidenceItems.length && author === 'ai') issues.push(issue('EVIDENCE_REQUIRED', 'The proposal does not cite any resume evidence.'));
  const evidenceText = evidenceItems.map((i) => i.text).join('\n');

  // Technologies and JD keywords.
  const proposedSkills = mentionsIn(text, facts.customEntries);
  const evidenceSkills = new Set(evidenceItems.flatMap((i) => [...(facts.mentions.get(i.id) ?? [])]));
  for (const skillId of proposedSkills) {
    if (facts.gapIds.has(skillId)) {
      const gap = facts.gaps.find((g) => g.id === skillId);
      const via = gap.relatedSkills?.length ? ` (you have ${gap.relatedSkills.join(', ')}, which is related but not the same skill)` : '';
      issues.push({ ...issue('GAP_KEYWORD', `“${gap.keyword}” is a gap in your resume${via}; it cannot be added.`), skillId });
      continue;
    }
    const proven = [...evidenceSkills].some((m) => m === skillId || (!String(skillId).startsWith('custom:') && provesSkill(m, skillId)));
    if (!proven) {
      issues.push({ ...issue('UNSUPPORTED_TECHNOLOGY', `“${skillName(skillId, facts.customEntries)}” is not named in the ${target.type === 'bullet' ? "original bullet or its role's evidence" : 'cited resume evidence'}.`), skillId });
    }
  }

  // Summary: a skill that only the skills list names (never a job or project) may be mentioned, but
  // the sentence around it can easily imply experience the resume does not describe
  // ("deployments to AWS Lambda"). The checker cannot judge that context, so the user must.
  if (target.type === 'summary') {
    const flagged = new Set(issues.map((i) => i.skillId).filter(Boolean));
    const originalSkills = mentionsIn(original ?? '', facts.customEntries);
    const used = [...facts.practicedSkills];
    const listOnly = [...proposedSkills].filter(
      (s) => !flagged.has(s) && !originalSkills.has(s) && !used.some((m) => m === s || (!String(s).startsWith('custom:') && provesSkill(m, s))),
    );
    if (listOnly.length) {
      const names = listOnly.map((s) => `“${skillName(s, facts.customEntries)}”`).join(', ');
      issues.push(issue('SKILL_LIST_ONLY', `${names} ${listOnly.length > 1 ? 'appear' : 'appears'} only in your skills list, not in any job or project. Check that the summary does not claim experience your resume does not describe.`, 'review'));
    }
  }

  // Unknown names: technical-looking or capitalised terms (Pulsar, gRPC, SOC2) that are neither in
  // the evidence nor an alias of a technology the evidence proves. Catches tools the taxonomy
  // does not know.
  // Hyphens and spaces are interchangeable ("Full-Stack" = "Full Stack").
  const loose = (s) => s.toLowerCase().replace(/[\s-]+/g, ' ');
  const evidenceLower = loose(evidenceText);
  const reported = new Set(issues.filter((i) => i.code === 'GAP_KEYWORD' || i.code === 'UNSUPPORTED_TECHNOLOGY').map((i) => i.skillId));
  const newTerms = termsIn(text).filter((term) => {
    const lower = loose(term);
    const singular = lower.replace(/(?<=[a-z])e?s$/, '');
    if (GENERIC_ACRONYMS.has(singular) || evidenceLower.includes(lower) || evidenceLower.includes(singular)) return false;
    const skills = mentionsIn(term, facts.customEntries);
    if ([...skills].some((s) => reported.has(s))) return false; // already reported above
    return !(skills.size && [...skills].every((s) => evidenceSkills.has(s) || [...evidenceSkills].some((m) => !String(s).startsWith('custom:') && provesSkill(m, s))));
  });
  if (newTerms.length) issues.push(issue('UNSUPPORTED_TERM', `Names or terms not found in the evidence: ${[...new Set(newTerms)].join(', ')}.`));

  // Numbers, metrics, years and vague quantities.
  const evidenceNumbers = numbersIn(evidenceText);
  const newNumbers = [...numbersIn(text)].filter((n) => !evidenceNumbers.has(n));
  if (newNumbers.length) issues.push(issue('UNSUPPORTED_NUMBER', `Numbers not found in the evidence: ${newNumbers.join(', ')}.`));
  else {
    const evidenceUnits = numberUnitsIn(evidenceText);
    const evidenceUnitNumbers = new Set([...evidenceUnits].map((u) => u.split(' ')[0]));
    // A number that the evidence ties to a unit must keep that unit ("12 minutes" ≠ "12 engineers").
    const changedUnits = [...numberUnitsIn(text)].filter((u) => !evidenceUnits.has(u) && evidenceUnitNumbers.has(u.split(' ')[0]));
    if (changedUnits.length) issues.push(issue('UNSUPPORTED_NUMBER', `Numbers used with a different meaning than in the evidence: ${changedUnits.join(', ')}.`));
  }
  const evidenceQuantities = quantityWordsIn(evidenceText);
  const newQuantities = [...quantityWordsIn(text)].filter((q) => !evidenceQuantities.has(q));
  if (newQuantities.length) issues.push(issue('UNSUPPORTED_QUANTITY', `Quantities not found in the evidence: ${newQuantities.join(', ')}.`));

  // Leadership / seniority wording.
  const evidenceClaims = roleClaimsIn(evidenceText);
  const inflated = [...roleClaimsIn(text)].filter((c) => !evidenceClaims.has(c));
  if (inflated.length) issues.push(issue('INFLATED_ROLE', `Adds leadership or seniority wording not in the evidence (${inflated.join(', ')}).`));

  // Professional identity (summary) and meaning of the actions described.
  issues.push(...checkIdentity({ text, original, target, identity: facts.identity, allowedDesignations: facts.allowedDesignations }));
  issues.push(...checkMeaning({ text, original, target, evidenceText, leadershipReported: inflated.length > 0 }));

  // Details dropped, length change. The AI may not shorten the summary by dropping its facts:
  // a summary is optimised by wording and emphasis, not by deleting experience.
  if (original) {
    const lostNumbers = [...numbersIn(original)].filter((n) => !numbersIn(text).has(n));
    const lostSkills = [...mentionsIn(original, facts.customEntries)].filter((s) => !proposedSkills.has(s)).map((s) => skillName(s, facts.customEntries));
    const lost = [...lostNumbers, ...lostSkills];
    const strictSummary = author === 'ai' && target.type === 'summary';
    if (lost.length) {
      issues.push(
        strictSummary
          ? issue('SUMMARY_DETAIL_REMOVED', `The summary must keep the facts of the original; it leaves out: ${lost.join(', ')}.`)
          : issue('REMOVED_DETAIL', `Leaves out details from the original: ${lost.join(', ')}.`, 'warning'),
      );
    }
    if (text.length > original.length * 1.25 + 15) issues.push(issue('LENGTH_GROWTH', `About ${Math.round((text.length / original.length - 1) * 100)}% longer than the original; it may need an extra line.`, 'warning'));
    if (strictSummary && text.length < original.length * SUMMARY_MIN_RATIO) {
      issues.push(issue('SUMMARY_TOO_SHORT', `About ${Math.round((1 - text.length / original.length) * 100)}% shorter than the original summary; important experience would be lost.`));
    } else if (text.length < original.length * 0.6) {
      issues.push(issue('MUCH_SHORTER', `About ${Math.round((1 - text.length / original.length) * 100)}% shorter than the original; check that nothing important was lost.`, 'warning'));
    }
  }

  return { passed: !issues.some((i) => i.severity === 'error'), needsReview: issues.some((i) => i.severity === 'review'), issues };
}
