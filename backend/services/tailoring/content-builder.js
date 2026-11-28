import crypto from 'node:crypto';
import { aliasPattern } from '../job-analysis/skill-taxonomy.js';
import { applyOrder, isPermutation } from './ordering.js';
import { layoutCheck, MAX_PAGES } from './resume-renderer.js';
import { GAP, SUPPORTED } from './fact-sheet.js';

/** Text of a change after the user's decision, or null when the original stays. */
export function effectiveText(change) {
  if (change.decision === 'accepted') return change.proposed;
  if (change.decision === 'edited') return change.editedText;
  return null;
}

/**
 * Applies the decided changes to the immutable base snapshot. Only the summary, the order of
 * skills and the text/order of experience bullets can differ from the base.
 */
export function buildContent(base, changes) {
  const content = structuredClone(base);
  for (const change of changes) {
    if (change.type === 'summary') {
      const text = effectiveText(change);
      if (text !== null) content.summary = text;
    }
    if (change.type === 'bullet') {
      const text = effectiveText(change);
      if (text !== null) content.experience[change.target.roleIndex].bullets[change.target.bulletIndex] = text;
    }
  }
  for (const change of changes) {
    if (change.decision !== 'accepted') continue;
    if (change.type === 'skills_order') {
      const { categoryOrder, itemOrders } = change.order;
      content.technicalSkills = categoryOrder.map((gi) => ({ ...content.technicalSkills[gi], items: applyOrder(content.technicalSkills[gi].items, itemOrders[gi]) }));
    }
    if (change.type === 'bullet_order') {
      const role = content.experience[change.target.roleIndex];
      role.bullets = applyOrder(role.bullets, change.order.bulletOrder);
    }
  }
  return content;
}

const stable = (v) => JSON.stringify(v);
export const contentHash = (content) => crypto.createHash('sha256').update(stable(content)).digest('hex');

/**
 * Structural guarantee that only the permitted fields changed. Returns a list of problems
 * (empty = everything locked is identical to the master snapshot).
 */
export function verifyLockedFields(base, content) {
  const problems = [];
  const same = (a, b) => stable(a) === stable(b);
  for (const key of ['personalInfo', 'headline', 'projects', 'education', 'certifications', 'achievements', 'sectionOrder']) {
    if (!same(base[key], content[key])) problems.push(`${key} must not change`);
  }
  if (base.technicalSkills.length !== content.technicalSkills.length) problems.push('the number of skill groups changed');
  else {
    const key = (groups) => groups.map((g) => `${g.category}\u0000${[...g.items].sort().join('\u0001')}`).sort();
    if (!same(key(base.technicalSkills), key(content.technicalSkills))) problems.push('skills were added, removed or renamed (only re-ordering is allowed)');
  }
  if (base.experience.length !== content.experience.length) problems.push('the number of roles changed');
  else {
    base.experience.forEach((role, i) => {
      const { bullets: b1, ...rest1 } = role;
      const { bullets: b2, ...rest2 } = content.experience[i];
      if (!same(rest1, rest2)) problems.push(`role ${i + 1}: company, title, location or dates changed`);
      if (b1.length !== b2.length) problems.push(`role ${i + 1}: the number of bullets changed`);
    });
  }
  const allowed = new Set(['personalInfo', 'headline', 'summary', 'technicalSkills', 'experience', 'projects', 'education', 'certifications', 'achievements', 'sectionOrder']);
  for (const key of Object.keys(content)) if (!allowed.has(key)) problems.push(`unexpected field ${key}`);
  return problems;
}

/** Validates an order change payload against the base content (defence in depth). */
export function validOrder(change, base) {
  if (change.type === 'skills_order') {
    const { categoryOrder, itemOrders } = change.order ?? {};
    return isPermutation(categoryOrder, base.technicalSkills.length) && Array.isArray(itemOrders) && itemOrders.length === base.technicalSkills.length && itemOrders.every((o, i) => isPermutation(o, base.technicalSkills[i].items.length));
  }
  if (change.type === 'bullet_order') return isPermutation(change.order?.bulletOrder, base.experience[change.target.roleIndex]?.bullets.length ?? -1);
  return true;
}

/** Resume text that recruiters/ATS read (contact details excluded). */
function searchableText(content) {
  return [
    content.headline,
    content.summary,
    ...content.technicalSkills.flatMap((g) => [g.category, ...g.items]),
    ...content.experience.flatMap((e) => [e.title, ...e.bullets]),
    ...content.projects.flatMap((p) => [p.name, ...p.technologies, ...p.bullets]),
    ...content.education.map((e) => e.degree),
    ...(content.certifications ?? []).map((c) => [c.name, c.issuer].filter(Boolean).join(' ')),
    ...content.achievements,
  ].join('\n');
}

/**
 * Literal keyword coverage: does the job's own wording appear in the resume text?
 * The evidence-based classification (from Phase 4) never changes through tailoring;
 * only how literally the resume states what it already evidences.
 */
export function keywordCoverage(before, after, requirements) {
  const textBefore = searchableText(before);
  const textAfter = searchableText(after);
  const literal = (text, r) => [r.keyword, ...(r.variants ?? [])].some((v) => {
    const p = aliasPattern(v);
    p.lastIndex = 0;
    return p.test(text);
  });
  const items = requirements.map((r) => ({
    keyword: r.keyword,
    importance: r.importance,
    classification: r.classification,
    supported: SUPPORTED.has(r.classification),
    before: literal(textBefore, r),
    after: literal(textAfter, r),
  }));
  const supported = items.filter((i) => i.supported);
  return {
    items,
    totalKeywords: items.length,
    supportedKeywords: supported.length,
    literalBefore: supported.filter((i) => i.before).length,
    literalAfter: supported.filter((i) => i.after).length,
    gapsUnchanged: items.filter((i) => GAP.has(i.classification)).map((i) => i.keyword),
    note: 'Gaps are never added. Only keywords your resume already evidences can appear in the job’s wording.',
  };
}

/** Pairs of { original, text } for every summary/bullet whose wording a decision changes. */
export function rewordedPairs(changes) {
  return changes
    .filter((c) => c.type === 'summary' || c.type === 'bullet')
    .map((c) => ({ original: c.original, text: effectiveText(c) }))
    .filter((p) => p.text !== null && p.text !== p.original);
}

/**
 * Layout of base vs tailored content with the Phase 1 engine (no PDF written).
 * Line growth is measured per reworded text against its own original (re-ordering moves
 * paragraphs, so positions cannot be compared).
 */
export function layoutReport(base, content, pairs = []) {
  const before = layoutCheck(base);
  const after = layoutCheck(content);
  const linesOf = (layout) => new Map(layout.paragraphs.map((p) => [p.text.replace(/^• /, ''), p.lineCount]));
  const beforeLines = linesOf(before);
  const afterLines = linesOf(after);
  const grown = pairs
    .map(({ original, text }) => ({ text: text.slice(0, 90), linesBefore: beforeLines.get(original), linesAfter: afterLines.get(text) }))
    .filter((g) => g.linesBefore !== undefined && g.linesAfter !== undefined && g.linesAfter > g.linesBefore);
  const errors = [];
  if (after.pageCount > MAX_PAGES) errors.push(`The tailored resume needs ${after.pageCount} pages; the maximum is ${MAX_PAGES}.`);
  if (after.overflowing.length) errors.push(`${after.overflowing.length} line(s) are wider than the page.`);
  if (after.paragraphs.length !== before.paragraphs.length) errors.push('The document structure differs from the master resume.');
  return {
    pageCount: after.pageCount,
    pageCountBefore: before.pageCount,
    maxPages: MAX_PAGES,
    lastPageFill: after.lastPageFill,
    lastPageFillBefore: before.lastPageFill,
    grownParagraphs: grown,
    errors,
    passed: errors.length === 0,
  };
}
