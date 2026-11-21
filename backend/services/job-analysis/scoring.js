/**
 * Transparent match score, computed in JavaScript (never by the AI).
 *
 *   credit(item)    = DIRECT_MATCH 1.00 | EXPERIENCE_SUPPORTED 0.85 | RELATED_EXPERIENCE 0.30 | MISSING 0
 *   coverage(group) = average credit of the items in the group
 *   score           = Σ weight(g) × coverage(g) / Σ weight(g)   over groups that have items
 *
 *   group weights   = must-have skills 50 · preferred skills 20 · optional skills 5
 *                     · responsibilities 15 · years of experience 10
 *
 * Groups the job description does not contain are left out and the remaining weights are
 * re-normalised, so a JD without "preferred" skills is not penalised. Items inside a group are
 * weighted equally, so a long list of responsibilities cannot outweigh the must-have skills.
 *
 * The score measures how much of THIS job description the master resume already evidences.
 * It is not a prediction of ATS results or hiring outcomes.
 */

export const CREDIT = { DIRECT_MATCH: 1, EXPERIENCE_SUPPORTED: 0.85, RELATED_EXPERIENCE: 0.3, MISSING: 0 };
export const GROUP_WEIGHTS = { mustHave: 50, preferred: 20, optional: 5, responsibilities: 15, experience: 10 };
export const GROUP_LABELS = {
  mustHave: 'Must-have skills',
  preferred: 'Preferred skills',
  optional: 'Optional skills',
  responsibilities: 'Responsibilities',
  experience: 'Years of experience',
};
export const SCORING_VERSION = 'weighted-v1';

export const SCORE_FORMULA =
  'score = Σ weight × coverage ÷ Σ weight, over the groups present in the job description. ' +
  'coverage = average credit per group (direct match 1.0, experience-supported 0.85, related 0.3, missing 0). ' +
  'weights: must-have 50, preferred 20, optional 5, responsibilities 15, years of experience 10.';

export const SCORE_DISCLAIMER =
  'This percentage shows how much of this job description your master resume already evidences. ' +
  'It is not an ATS score and does not predict screening or hiring outcomes.';

const round1 = (n) => Math.round(n * 10) / 10;

export function calculateMatchScore({ requirements, responsibilities, experience }) {
  const groups = {
    mustHave: requirements.filter((r) => r.importance === 'must_have'),
    preferred: requirements.filter((r) => r.importance === 'preferred'),
    optional: requirements.filter((r) => r.importance === 'optional'),
    responsibilities,
    experience: experience?.required && experience.classification ? [experience] : [],
  };

  const breakdown = Object.entries(groups).map(([key, items]) => {
    const counts = { DIRECT_MATCH: 0, EXPERIENCE_SUPPORTED: 0, RELATED_EXPERIENCE: 0, MISSING: 0 };
    items.forEach((i) => (counts[i.classification] += 1));
    const credit = items.reduce((sum, i) => sum + CREDIT[i.classification], 0);
    return {
      group: key,
      label: GROUP_LABELS[key],
      weight: GROUP_WEIGHTS[key],
      items: items.length,
      counts,
      credit: round1(credit),
      coverage: items.length ? round1((credit / items.length) * 100) : null,
      included: items.length > 0,
    };
  });

  const included = breakdown.filter((b) => b.included);
  const totalWeight = included.reduce((s, b) => s + b.weight, 0);
  const weighted = included.reduce((s, b) => s + b.weight * (b.coverage / 100), 0);
  for (const b of breakdown) b.effectiveWeight = b.included && totalWeight ? round1((b.weight / totalWeight) * 100) : 0;

  const all = Object.values(groups).flat();
  const count = (c) => all.filter((i) => i.classification === c).length;
  const mustHave = groups.mustHave;
  const mustHaveMet = mustHave.filter((r) => r.classification === 'DIRECT_MATCH' || r.classification === 'EXPERIENCE_SUPPORTED').length;

  return {
    version: SCORING_VERSION,
    matchPercentage: totalWeight ? Math.round((weighted / totalWeight) * 100) : 0,
    totalRequirements: all.length,
    matchedRequirements: count('DIRECT_MATCH') + count('EXPERIENCE_SUPPORTED'),
    directMatches: count('DIRECT_MATCH'),
    experienceSupported: count('EXPERIENCE_SUPPORTED'),
    partiallySupportedRequirements: count('RELATED_EXPERIENCE'),
    missingRequirements: count('MISSING'),
    mustHaveCoverage: mustHave.length ? Math.round((mustHaveMet / mustHave.length) * 100) : null,
    mustHaveMissing: mustHave.filter((r) => r.classification === 'MISSING').map((r) => r.keyword),
    breakdown,
    credits: CREDIT,
    formula: SCORE_FORMULA,
    disclaimer: SCORE_DISCLAIMER,
  };
}
