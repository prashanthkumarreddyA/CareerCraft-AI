/**
 * Turns the structured master resume into numbered evidence items: the ONLY resume data the
 * matcher and the AI see.
 *
 * Privacy (Phase 4 rules): personalInfo (name, phone, email, links, location) is never included;
 * company names, institutions and locations are left out because matching does not need them;
 * any email, phone number or URL that appears inside free text is redacted, as is the person's
 * name. The original PDF is never used here.
 */

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const PRESENT = /^(present|current|now|till date|to date|ongoing)$/i;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// URLs end before trailing punctuation ("…/alex; built" keeps the semicolon).
const URL = /\b(?:https?:\/\/|www\.|(?:linkedin|github)\.com\/)[^\s]*?(?=[.,;:!?)\]]*(?:\s|$))/gi;
const PHONE = /(?<![\w.])\+?\d[\d\s().-]{7,}\d(?![\w.])/g;

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function createRedactor(personalInfo = {}) {
  const nameParts = String(personalInfo.fullName ?? '')
    .split(/\s+/)
    .filter((p) => p.length >= 3);
  const namePattern = nameParts.length ? new RegExp(`\\b(?:${nameParts.map(escapeRegExp).join('|')})\\b`, 'gi') : null;
  return (text) => {
    let out = String(text ?? '')
      .replace(EMAIL, '[email]')
      .replace(URL, '[link]')
      .replace(PHONE, (m) => (m.replace(/\D/g, '').length >= 9 ? '[phone]' : m));
    if (namePattern) out = out.replace(namePattern, '[name]');
    return out.replace(/\s+/g, ' ').trim();
  };
}

/** Parses "Feb 2025", "02/2025", "2025", "Present". Returns a month index (year*12+month) or null. */
export function parseResumeDate(value, today = new Date()) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (PRESENT.test(text)) return today.getFullYear() * 12 + today.getMonth();
  let m = /^([A-Za-z]{3,9})\.?\s+(\d{4})$/.exec(text);
  if (m && MONTHS[m[1].slice(0, m[1].toLowerCase().startsWith('sept') ? 4 : 3).toLowerCase()] !== undefined) {
    return Number(m[2]) * 12 + MONTHS[m[1].slice(0, m[1].toLowerCase().startsWith('sept') ? 4 : 3).toLowerCase()];
  }
  m = /^(\d{1,2})[/.-](\d{4})$/.exec(text);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return Number(m[2]) * 12 + Number(m[1]) - 1;
  m = /^(\d{4})$/.exec(text);
  if (m) return Number(m[1]) * 12;
  return null;
}

/**
 * Total professional experience in years from the experience section, merging overlapping
 * roles so concurrent jobs are not double counted. Returns { years, months, complete }.
 * End months are inclusive ("Jan 2024 – Jan 2024" counts as one month).
 */
export function computeExperienceYears(experience = [], today = new Date()) {
  const intervals = [];
  let complete = experience.length > 0;
  for (const role of experience) {
    const start = parseResumeDate(role.startDate, today);
    const end = parseResumeDate(role.endDate, today);
    if (start === null || end === null || end < start) {
      complete = false;
      continue;
    }
    intervals.push([start, end + 1]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  let months = 0;
  let current = null;
  for (const [s, e] of intervals) {
    if (!current || s > current[1]) {
      if (current) months += current[1] - current[0];
      current = [s, e];
    } else current[1] = Math.max(current[1], e);
  }
  if (current) months += current[1] - current[0];
  return { months, years: Math.round((months / 12) * 10) / 10, complete: complete && intervals.length > 0 };
}

const splitSentences = (text) =>
  String(text ?? '')
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * @returns {{ items: Array<{ id, section, label, text }>, byId: Map, experienceYears, roles }}
 * ids: headline, summary.1, skills.<g>.<i>, exp.<i>.role, exp.<i>.<j>, proj.<i>.name, proj.<i>.tech,
 *      proj.<i>.<j>, edu.<i>, ach.<i>   (1-based, stable for a given resume)
 */
export function buildResumeEvidence(resume, { today = new Date() } = {}) {
  const redact = createRedactor(resume.personalInfo);
  const items = [];
  const add = (id, section, label, text) => {
    const clean = redact(text);
    if (clean) items.push({ id, section, label, text: clean });
  };

  if (resume.headline) add('headline', 'headline', 'Headline', resume.headline);
  splitSentences(resume.summary).forEach((s, i) => add(`summary.${i + 1}`, 'summary', 'Summary', s));

  (resume.technicalSkills ?? []).forEach((group, g) => {
    group.items.forEach((item, i) => add(`skills.${g + 1}.${i + 1}`, 'skills', `Technical skills › ${group.category}`, item));
  });

  const roles = [];
  (resume.experience ?? []).forEach((role, r) => {
    const period = [role.startDate, role.endDate].filter(Boolean).join(' – ');
    const label = `Experience › ${role.title || `Role ${r + 1}`}${period ? ` (${period})` : ''}`;
    roles.push({ id: `exp.${r + 1}.role`, title: role.title, period });
    add(`exp.${r + 1}.role`, 'experience', label, `${role.title || 'Role'}${period ? `, ${period}` : ''}`);
    role.bullets.forEach((b, i) => add(`exp.${r + 1}.${i + 1}`, 'experience', label, b));
  });

  (resume.projects ?? []).forEach((project, p) => {
    const label = `Project › ${project.name}`;
    add(`proj.${p + 1}.name`, 'projects', label, project.name);
    if (project.technologies.length) add(`proj.${p + 1}.tech`, 'projects', `${label} › technologies`, project.technologies.join(', '));
    project.bullets.forEach((b, i) => add(`proj.${p + 1}.${i + 1}`, 'projects', label, b));
  });

  (resume.education ?? []).forEach((edu, e) => {
    const text = [edu.degree, edu.score, [edu.startDate, edu.endDate].filter(Boolean).join(' – ')].filter(Boolean).join('; ');
    add(`edu.${e + 1}`, 'education', 'Education', text);
  });

  (resume.achievements ?? []).forEach((a, i) => add(`ach.${i + 1}`, 'achievements', 'Achievements', a));

  return {
    items,
    byId: new Map(items.map((item) => [item.id, item])),
    experienceYears: computeExperienceYears(resume.experience, today),
    roles,
  };
}

/** Compact, line-based form sent to the AI: "[id] text". */
export function formatEvidenceForPrompt(items) {
  return items.map((item) => `[${item.id}] (${item.section}) ${item.text}`).join('\n');
}
