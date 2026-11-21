import { provesSkill } from '../job-analysis/skill-taxonomy.js';
import { mentionsIn, SUPPORTED } from './fact-sheet.js';

/**
 * Deterministic re-ordering (no AI): skills and bullets that evidence this job's supported
 * requirements move up; everything else keeps its original relative order. Nothing is added,
 * removed or renamed, so these changes cannot introduce claims.
 */

const WEIGHT = { must_have: 3, preferred: 2, optional: 1 };

/** Supported requirements that a piece of text evidences. */
function requirementsIn(text, facts) {
  const skills = mentionsIn(text, facts.customEntries);
  return facts.supported.filter((r) => [...skills].some((s) => s === r.id || (!String(r.id).startsWith('custom:') && provesSkill(s, r.id))));
}

const stableSortBy = (items, score) =>
  items
    .map((item, index) => ({ item, index, score: score(item, index) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

const sameOrder = (order) => order.every((v, i) => v === i);

/**
 * @returns null when the current order is already best, otherwise
 *   { categoryOrder: number[], itemOrders: number[][], explanation, details }
 */
export function proposeSkillsOrder(facts) {
  const groups = facts.resume.technicalSkills;
  const scored = groups.map((group) => {
    const items = group.items.map((item) => {
      const reqs = requirementsIn(item, facts);
      return { item, reqs, score: reqs.reduce((s, r) => s + WEIGHT[r.importance], 0) };
    });
    return { group, items, score: items.reduce((s, i) => s + i.score, 0) };
  });

  const categoryOrder = stableSortBy(scored, (g) => g.score).map((x) => x.index);
  const itemOrders = scored.map((g) => stableSortBy(g.items, (i) => i.score).map((x) => x.index));
  if (sameOrder(categoryOrder) && itemOrders.every(sameOrder)) return null;

  const moved = scored
    .filter((g) => g.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((g) => `${g.group.category} (${[...new Set(g.items.flatMap((i) => i.reqs.map((r) => r.keyword)))].slice(0, 4).join(', ')})`);
  return {
    categoryOrder,
    itemOrders,
    explanation: `Puts the skill groups and skills this job asks for first. Most relevant: ${moved.join('; ')}. No skill is added, removed or renamed.`,
  };
}

/** Per-role bullet order. Returns [{ roleIndex, order, explanation }] for roles whose order changes. */
export function proposeBulletOrders(facts) {
  const out = [];
  facts.resume.experience.forEach((role, r) => {
    const scored = role.bullets.map((bullet, b) => {
      const reqs = requirementsIn(bullet, facts);
      const respBonus = facts.supportedResponsibilityEvidence.has(`exp.${r + 1}.${b + 1}`) ? 2 : 0;
      return { reqs, score: reqs.reduce((s, q) => s + WEIGHT[q.importance], 0) + respBonus, respBonus };
    });
    const order = stableSortBy(scored, (s) => s.score).map((x) => x.index);
    if (sameOrder(order)) return;
    const top = order
      .slice(0, 3)
      .filter((i) => scored[i].score > 0)
      .map((i) => {
        const keys = [...new Set(scored[i].reqs.map((q) => q.keyword))];
        return `bullet ${i + 1}${keys.length ? ` (${keys.slice(0, 3).join(', ')})` : ''}${scored[i].respBonus ? ' supports a listed responsibility' : ''}`;
      });
    out.push({
      roleIndex: r,
      order,
      explanation: `Moves the most relevant bullets for this job to the top: ${top.join('; ')}. Bullets stay within the same role.`,
    });
  });
  return out;
}

export const applyOrder = (list, order) => order.map((i) => list[i]);
export const isPermutation = (order, length) => Array.isArray(order) && order.length === length && new Set(order).size === length && order.every((i) => Number.isInteger(i) && i >= 0 && i < length);
