import { allEntries, aliasPattern, getEntry, lookupSkill, normalizeKey, provesSkill, relationBetween, TECHNOLOGY_CATEGORIES } from './skill-taxonomy.js';

/**
 * Deterministic verification layer between the AI answer and the stored result.
 * The AI proposes; these rules decide:
 *  1. A JD keyword is kept only if it really appears in the job description.
 *  2. Duplicates (same technology, different spelling) are merged.
 *  3. DIRECT_MATCH is decided by searching the resume evidence for the technology or one of its
 *     more specific parts (alias-aware, word-boundary-aware). The AI cannot create a direct match.
 *  4. Concrete technologies are named in the resume (DIRECT_MATCH) or MISSING: never
 *     EXPERIENCE_SUPPORTED or RELATED_EXPERIENCE. A related technology the resume does name
 *     (Express.js for NestJS, AWS EC2 for AWS Lambda) is shown as context only (relatedSkills,
 *     relatedEvidence) and earns no credit.
 *  5. Concepts/practices may be EXPERIENCE_SUPPORTED by the AI, but only with evidence ids that
 *     exist in the resume. Every non-missing result carries resume evidence.
 */

const CLASS_RANK = { MISSING: 0, RELATED_EXPERIENCE: 1, EXPERIENCE_SUPPORTED: 2, DIRECT_MATCH: 3 };
const IMPORTANCE_RANK = { optional: 0, preferred: 1, must_have: 2 };
const SECTION_ORDER = { skills: 0, experience: 1, projects: 2, summary: 3, headline: 4, achievements: 5, education: 6 };
const MAX_EVIDENCE = 4;

const sortEvidence = (items) => [...items].sort((a, b) => (SECTION_ORDER[a.section] ?? 9) - (SECTION_ORDER[b.section] ?? 9));
const toEvidence = (items) => sortEvidence(items).slice(0, MAX_EVIDENCE).map(({ id, label, text }) => ({ id, source: label, text }));
const uniq = (list) => [...new Set(list)];

/** True if `term` occurs in the job description (alias-aware boundaries, case-insensitive). */
export function termAppearsIn(text, term) {
  const t = String(term ?? '').trim();
  if (!t) return false;
  if (aliasPattern(t).test(text)) return true;
  const key = normalizeKey(t);
  return key.length >= 4 && normalizeKey(text).includes(key);
}

/**
 * Skill names found in a text as non-overlapping spans { id, start, end }, in text order.
 * The longest match wins ("React Native" hides "React").
 */
export function findSkillSpans(text, entries = allEntries()) {
  const spans = [];
  for (const entry of entries) {
    for (const pattern of entry.patterns) {
      pattern.lastIndex = 0;
      for (const m of String(text).matchAll(pattern)) spans.push({ id: entry.id, start: m.index, end: m.index + m[0].length });
    }
  }
  spans.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const accepted = [];
  for (const span of spans) {
    if (!accepted.some((s) => span.start < s.end && s.start < span.end)) accepted.push(span);
  }
  return accepted.sort((a, b) => a.start - b.start);
}

/** Builds the skill index for one resume: which skills each evidence item names (longest match wins). */
export function indexResumeMentions(evidenceItems, customEntries = []) {
  const entries = [...allEntries(), ...customEntries];
  const mentions = new Map(); // evidence id -> Set(skill id)
  for (const item of evidenceItems) mentions.set(item.id, new Set(findSkillSpans(item.text, entries).map((s) => s.id)));
  return mentions;
}

// Words that only describe the kind of thing a technology is ("NestJS framework", "GraphQL APIs",
// "AWS Lambda functions") or join several technologies ("Node.js/NestJS", "AWS (Lambda, S3)").
// They add no requirement of their own. Anything else ("GraphQL subscriptions") does.
const QUALIFIER_WORDS = new Set([
  'framework', 'frameworks', 'library', 'libraries', 'api', 'apis', 'function', 'functions', 'service', 'services',
  'development', 'programming', 'language', 'languages', 'platform', 'platforms', 'ecosystem', 'experience',
  'knowledge', 'proficiency', 'skills', 'stack', 'tools', 'tooling', 'technologies', 'technology', 'environment',
  'environments', 'cloud', 'backend', 'frontend', 'based', 'using', 'with', 'and', 'or', 'plus', 'including',
  'such', 'as', 'like', 'eg', 'e', 'g', 'etc', 'the', 'a', 'an', 'in', 'of', 'hands', 'on', 'strong', 'solid',
]);

/**
 * Known skills a JD term consists of, as [{ id, text }] (JD spelling), or [] when the term is
 * not fully explained by known skills plus qualifier words.
 *  "NestJS framework" → [NestJS]; "Node.js/NestJS" → [Node.js, NestJS];
 *  "GraphQL subscriptions" → [] ("subscriptions" is a requirement of its own, not proven by GraphQL).
 */
export function knownSkillsInTerm(term) {
  const text = String(term ?? '');
  const spans = findSkillSpans(text);
  if (!spans.length) return [];
  let rest = '';
  let last = 0;
  for (const s of spans) {
    rest += ` ${text.slice(last, s.start)} `;
    last = s.end;
  }
  rest += text.slice(last);
  const leftover = rest.toLowerCase().match(/[a-z0-9+#]+/g) ?? [];
  if (!leftover.every((w) => QUALIFIER_WORDS.has(w))) return [];
  const seen = new Set();
  const parts = spans.filter((s) => !seen.has(s.id) && seen.add(s.id));
  // "AWS Lambda functions" / "AWS (Lambda, S3)": the platform is implied by its named parts.
  return parts
    .filter((p) => !parts.some((o) => o.id !== p.id && provesSkill(o.id, p.id)))
    .map((s) => ({ id: s.id, text: text.slice(s.start, s.end) }));
}

/** Entry for a requirement the taxonomy does not know (searched by its own spellings only). */
function customEntry(requirement) {
  const spellings = uniq([requirement.term, requirement.normalizedName].map((s) => s.trim()).filter((s) => s.length >= 2));
  return {
    id: `custom:${normalizeKey(requirement.normalizedName || requirement.term)}`,
    name: requirement.normalizedName || requirement.term,
    category: requirement.category,
    concept: !TECHNOLOGY_CATEGORIES.has(requirement.category),
    custom: true,
    patterns: spellings.map((s) => aliasPattern(s.length <= 3 ? `=${s}` : s)),
  };
}

/**
 * Verifies, de-duplicates and canonicalises the AI's requirement list.
 * Returns { requirements, dropped, merged }.
 */
export function consolidateRequirements(aiRequirements, jobDescription) {
  const groups = new Map();
  let dropped = 0;
  let merged = 0;
  for (const raw of aiRequirements) {
    let term = raw.term;
    if (!termAppearsIn(jobDescription, term)) {
      if (raw.normalizedName && termAppearsIn(jobDescription, raw.normalizedName)) term = raw.normalizedName;
      else {
        dropped += 1; // not in the JD: an AI invention, never shown or scored
        continue;
      }
    }
    // Resolve the term to known skills: an exact name/alias, or a phrase made only of known skills and
    // qualifier words ("NestJS framework", "Node.js/NestJS"). Without this, a phrase becomes an
    // unknown requirement that a resume naming the same technology can never prove.
    const exact = lookupSkill(term, raw.normalizedName);
    const parts = exact ? [{ id: exact, text: term }] : knownSkillsInTerm(term).filter((p) => termAppearsIn(jobDescription, p.text));
    const resolved = parts.length ? parts : [{ id: null, text: term }];
    const ai = { classification: raw.classification, evidenceIds: raw.evidenceIds, relatedSkill: raw.relatedSkill, rationale: raw.rationale };
    for (const part of resolved) {
      const skillId = part.id;
      const entry = skillId ? getEntry(skillId) : customEntry({ ...raw, term });
      const key = entry.id;
      const existing = groups.get(key);
      if (existing) {
        merged += 1;
        existing.variants = uniq([...existing.variants, part.text]);
        if (IMPORTANCE_RANK[raw.importance] > IMPORTANCE_RANK[existing.importance]) existing.importance = raw.importance;
        if (CLASS_RANK[ai.classification] > CLASS_RANK[existing.ai.classification]) existing.ai = ai;
        continue;
      }
      groups.set(key, {
        key,
        keyword: part.text, // JD terminology preserved
        variants: [part.text],
        normalizedName: skillId ? entry.name : raw.normalizedName || term,
        category: skillId ? entry.category : raw.category,
        importance: raw.importance,
        known: Boolean(skillId),
        entry,
        ai,
      });
    }
  }
  return { requirements: [...groups.values()], dropped, merged };
}

const isTechnology = (req) => !req.entry.concept && TECHNOLOGY_CATEGORIES.has(req.category);
const sourcesText = (evidence) => uniq(evidence.map((e) => e.source)).slice(0, 3).join('; ');

/** Decides the final classification of one consolidated requirement. */
export function matchRequirement(req, ctx) {
  const { evidence: resume, mentions } = ctx;
  const aiClass = req.ai.classification;
  const adjustments = [];
  const result = (classification, evidenceItems, extra) => ({
    id: req.key,
    keyword: req.keyword,
    variants: req.variants,
    normalizedName: req.normalizedName,
    category: req.category,
    importance: req.importance,
    classification,
    evidence: toEvidence(evidenceItems),
    relatedSkills: [],
    aiClassification: aiClass,
    adjustments,
    ...extra,
  });

  // 1. Named in the resume (the technology itself or a more specific part of it).
  const proves = (skillId) => (req.entry.custom ? skillId === req.entry.id : provesSkill(skillId, req.entry.id));
  const direct = resume.items.filter((item) => [...(mentions.get(item.id) ?? [])].some(proves));
  if (direct.length) {
    const evidence = toEvidence(direct);
    return result('DIRECT_MATCH', direct, {
      decidedBy: 'rules',
      explanation: `“${req.normalizedName}” is named in your resume (${sourcesText(evidence)}).`,
    });
  }

  // Related technologies the taxonomy knows about (never a match, only context).
  const relatedFound = new Map(); // skill id -> [evidence items]
  if (req.known) {
    for (const item of resume.items) {
      for (const skillId of mentions.get(item.id) ?? []) {
        if (relationBetween(req.entry.id, skillId)) relatedFound.set(skillId, [...(relatedFound.get(skillId) ?? []), item]);
      }
    }
  }
  const relatedResult = (decidedBy, explanationPrefix = '') => {
    const names = [...relatedFound.keys()].map((id) => getEntry(id)?.name ?? id).slice(0, 3);
    const items = [...relatedFound.values()].flat();
    return result('RELATED_EXPERIENCE', items, {
      decidedBy,
      relatedSkills: names,
      explanation: `${explanationPrefix}Your resume names ${names.join(', ')}, which ${names.length > 1 ? 'are' : 'is'} related to ${req.normalizedName} but not the same. ${req.normalizedName} itself is not claimed.`,
    });
  };

  const validAiEvidence = (allowSkills = true) => req.ai.evidenceIds.map((id) => resume.byId.get(id)).filter((item) => item && (allowSkills || item.section !== 'skills'));

  // 2. Concrete technologies: named or not. AI "experience" claims are not accepted.
  if (isTechnology(req)) {
    if (aiClass === 'DIRECT_MATCH' || aiClass === 'EXPERIENCE_SUPPORTED') {
      adjustments.push(`The AI suggested ${aiClass === 'DIRECT_MATCH' ? 'a direct match' : 'experience support'}, but ${req.normalizedName} is not named anywhere in your resume, and a technology only counts when it is named.`);
    }
    let decidedBy = 'rules';
    if (!relatedFound.size && !req.known && aiClass !== 'MISSING' && req.ai.relatedSkill) {
      // Unknown technology: the AI's related skill is shown as context only if it is a known skill of the same category cited in the evidence.
      const relatedId = lookupSkill(req.ai.relatedSkill);
      const cited = validAiEvidence().filter((item) => relatedId && mentions.get(item.id)?.has(relatedId));
      if (relatedId && cited.length && getEntry(relatedId).category === req.category) {
        relatedFound.set(relatedId, cited);
        decidedBy = 'ai+rules';
      } else {
        adjustments.push(`The AI linked this to “${req.ai.relatedSkill}”, which could not be verified as a related ${req.category} skill in your resume.`);
      }
    } else if (!relatedFound.size && req.known && aiClass === 'RELATED_EXPERIENCE') {
      adjustments.push(`The AI suggested related experience${req.ai.relatedSkill ? ` (“${req.ai.relatedSkill}”)` : ''}, but that is not a recognised relation for ${req.normalizedName}.`);
    }
    // A technology counts only when it is named. A related technology (Express.js for NestJS,
    // AWS EC2 for AWS Lambda) is NOT the skill: it is MISSING, earns no credit, and the related
    // skill is shown only as context.
    if (relatedFound.size) {
      const names = [...relatedFound.keys()].map((id) => getEntry(id)?.name ?? id).slice(0, 3);
      return result('MISSING', [], {
        decidedBy,
        relatedSkills: names,
        relatedEvidence: toEvidence([...relatedFound.values()].flat()),
        explanation: `${req.normalizedName} is not named in your resume. You have ${names.join(', ')}, which ${names.length > 1 ? 'are' : 'is'} related but not the same skill, so it earns no credit.`,
      });
    }
    return result('MISSING', [], { decidedBy, explanation: `${req.normalizedName} does not appear in your resume, and no related technology was found.` });
  }

  // 3. Concepts and practices: AI judgement, accepted only with real evidence.
  if (aiClass !== 'MISSING') {
    const items = validAiEvidence();
    if (!items.length) {
      adjustments.push('The AI suggested support but cited no valid resume evidence, so it is treated as missing.');
    } else {
      let classification = aiClass;
      if (aiClass === 'DIRECT_MATCH') {
        classification = 'EXPERIENCE_SUPPORTED';
        adjustments.push(`“${req.normalizedName}” is not named verbatim in your resume, so this counts as experience-supported rather than a direct match.`);
      }
      if (classification === 'EXPERIENCE_SUPPORTED' || !relatedFound.size) {
        return result(classification, items, {
          decidedBy: 'ai',
          relatedSkills: classification === 'RELATED_EXPERIENCE' && req.ai.relatedSkill ? [req.ai.relatedSkill] : [],
          explanation: req.ai.rationale || 'Supported by the cited resume evidence.',
        });
      }
    }
  }
  if (relatedFound.size) return relatedResult('rules');
  return result('MISSING', [], { decidedBy: aiClass === 'MISSING' ? 'ai' : 'rules', explanation: req.ai.rationale && aiClass === 'MISSING' ? req.ai.rationale : `No evidence of ${req.normalizedName} was found in your resume.` });
}

const WORD = /[a-z0-9][a-z0-9+#.]*/g;
/** A responsibility is kept only if most of its words appear in the job description. */
export function responsibilityAppearsIn(jobDescription, text) {
  const jdWords = new Set(jobDescription.toLowerCase().match(WORD) ?? []);
  const words = (text.toLowerCase().match(WORD) ?? []).filter((w) => w.length >= 4);
  if (words.length < 2) return false;
  return words.filter((w) => jdWords.has(w)).length / words.length >= 0.6;
}

export function matchResponsibilities(aiResponsibilities, ctx, jobDescription) {
  const seen = new Set();
  const out = [];
  let dropped = 0;
  for (const raw of aiResponsibilities) {
    const key = normalizeKey(raw.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (!responsibilityAppearsIn(jobDescription, raw.text)) {
      dropped += 1;
      continue;
    }
    const adjustments = [];
    // Responsibilities are supported by what was done (experience/projects), not by a skills list.
    const items = raw.evidenceIds.map((id) => ctx.evidence.byId.get(id)).filter((item) => item && item.section !== 'skills' && item.section !== 'education');
    let classification = raw.classification === 'DIRECT_MATCH' ? 'EXPERIENCE_SUPPORTED' : raw.classification;
    if (classification !== 'MISSING' && !items.length) {
      adjustments.push('No valid experience or project evidence was cited, so this is treated as missing.');
      classification = 'MISSING';
    }
    out.push({
      id: `resp.${out.length + 1}`,
      text: raw.text,
      classification,
      evidence: classification === 'MISSING' ? [] : toEvidence(items),
      explanation: raw.rationale,
      aiClassification: raw.classification,
      adjustments,
      decidedBy: 'ai',
    });
    if (out.length >= 15) break;
  }
  return { responsibilities: out, dropped };
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen'];

/** True if the JD actually states `years` years of experience (digits or words). */
export function yearsStatedIn(jobDescription, years) {
  const n = Math.round(years * 10) / 10;
  const tokens = [String(n), NUMBER_WORDS[n]].filter(Boolean).map((t) => t.replace('.', '\\.'));
  return new RegExp(`(?<![\\d.])(?:${tokens.join('|')})\\s*(?:\\+|plus)?\\s*(?:(?:-|–|to)\\s*\\d+(?:\\.\\d+)?\\s*\\+?\\s*)?(?:\\(\\d+\\)\\s*)?(?:years?|yrs?)`, 'i').test(jobDescription);
}

export function matchExperience(aiExperience, ctx, jobDescription) {
  const { minYears, maxYears, quote } = aiExperience;
  const { years, complete, months } = ctx.evidence.experienceYears;
  const base = { minYears: null, maxYears: null, quote: null, resumeYears: years, resumeYearsComplete: complete };
  if (minYears === null || minYears === undefined || minYears <= 0) return { ...base, required: false, classification: null, explanation: 'The job description does not state a minimum number of years.' };
  if (!yearsStatedIn(jobDescription, minYears)) {
    return { ...base, required: false, classification: null, unverified: true, explanation: 'A years-of-experience requirement could not be verified in the job description text, so it is not scored.' };
  }
  const roleEvidence = ctx.evidence.roles.map((r) => ctx.evidence.byId.get(r.id)).filter(Boolean);
  const common = { ...base, minYears, maxYears: maxYears ?? null, quote, required: true };
  if (!months) {
    return { ...common, classification: 'MISSING', evidence: [], explanation: 'Your experience dates could not be read, so the years requirement could not be checked.' };
  }
  const resumeText = `${years} year${years === 1 ? '' : 's'}${complete ? '' : ' (some dates could not be read)'}`;
  if (years >= minYears) {
    return { ...common, classification: 'DIRECT_MATCH', evidence: toEvidence(roleEvidence), explanation: `The role asks for ${minYears}+ years; your experience section covers about ${resumeText}.` };
  }
  if (years >= minYears - 1) {
    return { ...common, classification: 'RELATED_EXPERIENCE', evidence: toEvidence(roleEvidence), explanation: `The role asks for ${minYears}+ years; your experience section covers about ${resumeText}, slightly below the requirement.` };
  }
  return { ...common, classification: 'MISSING', evidence: toEvidence(roleEvidence), explanation: `The role asks for ${minYears}+ years; your experience section covers about ${resumeText}.` };
}
