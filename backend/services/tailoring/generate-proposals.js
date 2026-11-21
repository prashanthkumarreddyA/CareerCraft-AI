import { buildFactSheet } from './fact-sheet.js';
import { checkClaim, normalizeText } from './claim-checker.js';
import { proposeBulletOrders, proposeSkillsOrder } from './ordering.js';
import { buildTailoringPrompt, TAILORING_INSTRUCTION, tailoringAnswerJsonSchema, tailoringAnswerSchema } from './tailoring-prompt.js';

export const GENERATOR_VERSION = 'phase5-v2';

const BULLET_ID = /^exp\.(\d+)\.(\d+)$/;

const evidenceView = (facts, ids) =>
  [...new Set(ids)]
    .map((id) => facts.evidence.byId.get(id))
    .filter(Boolean)
    .map(({ id, label, text }) => ({ id, source: label, text }));

/** Keeps only targeted keywords that are supported requirements of this job and appear in the text. */
function cleanTargets(targets, text, facts) {
  const lower = text.toLowerCase();
  return [
    ...new Set(
      targets
        .map((t) => facts.supported.find((r) => [r.keyword, ...(r.variants ?? []), r.normalizedName].some((v) => v && v.toLowerCase() === t.toLowerCase())))
        .filter((r) => r && [r.keyword, ...(r.variants ?? [])].some((v) => lower.includes(v.toLowerCase())))
        .map((r) => r.keyword),
    ),
  ];
}

const words = (s) => String(s).toLowerCase().match(/[a-z0-9][a-z0-9.+#-]*[a-z0-9+#]|[a-z0-9]/g) ?? [];

/**
 * True when a rewrite only deletes words from the original (e.g. "AWS EC2" → "AWS",
 * dropping "Express.js"). Such proposals add no wording the job asks for and only make the
 * bullet vaguer, so they are not offered.
 */
export function isDeletionOnly(original, text) {
  const available = new Set(words(original));
  return words(text).every((w) => available.has(w));
}

/** Turns one AI answer into checked candidates: { accepted: [...], failed: [...] }. */
function evaluateAnswer(answer, facts) {
  const accepted = [];
  const failed = [];
  const consider = (candidate) => {
    const result = checkClaim({ ...candidate, author: 'ai' }, facts);
    (result.passed ? accepted : failed).push({ ...candidate, validation: result });
  };

  if (answer.summary) {
    const text = normalizeText(answer.summary.text);
    const original = facts.resume.summary;
    if (text && text !== normalizeText(original)) {
      consider({ key: 'summary', target: { type: 'summary' }, original, text, evidenceIds: answer.summary.evidenceIds, targetedKeywords: answer.summary.targetedKeywords, rationale: answer.summary.rationale });
    }
  }

  const seen = new Set();
  for (const b of answer.bullets) {
    const m = BULLET_ID.exec(b.id.trim());
    const roleIndex = m ? Number(m[1]) - 1 : -1;
    const bulletIndex = m ? Number(m[2]) - 1 : -1;
    const original = facts.resume.experience[roleIndex]?.bullets[bulletIndex];
    if (original === undefined || seen.has(b.id)) continue; // not an experience bullet, or a duplicate
    seen.add(b.id);
    const text = normalizeText(b.text);
    if (!text || text === normalizeText(original)) continue;
    if (isDeletionOnly(original, text)) continue; // only removes details: no value for the candidate
    consider({ key: `bullet-${roleIndex + 1}-${bulletIndex + 1}`, target: { type: 'bullet', roleIndex, bulletIndex }, original, text, evidenceIds: b.evidenceIds, targetedKeywords: b.targetedKeywords, rationale: b.rationale });
  }
  return { accepted, failed };
}

const promptId = (c) => (c.target.type === 'summary' ? 'summary' : `exp.${c.target.roleIndex + 1}.${c.target.bulletIndex + 1}`);

/**
 * Generates reviewable changes for one job analysis.
 * @returns {{ changes, blocked, ai, factsSummary }}
 */
export async function generateTailoringProposals({ resume, analysis, ai, today }) {
  const facts = buildFactSheet(resume, analysis, { today });
  const request = (only) => ({
    task: only ? 'tailoring-repair' : 'tailoring',
    systemInstruction: TAILORING_INSTRUCTION,
    prompt: buildTailoringPrompt({ jobTitle: analysis.jobTitle, facts, only }),
    schema: tailoringAnswerSchema,
    jsonSchema: tailoringAnswerJsonSchema,
  });

  const first = await ai.generateJson(request());
  let { accepted, failed } = evaluateAnswer(first.data, facts);
  const aiMeta = { provider: first.provider, model: first.model, latencyMs: first.latencyMs, attempts: first.attempts, repairRound: false };

  // One repair round for rejected proposals; whatever still fails is blocked (never offered).
  if (failed.length) {
    try {
      const repair = await ai.generateJson(request(failed.map((c) => ({ id: promptId(c), text: c.text, issues: c.validation.issues.filter((i) => i.severity === 'error') }))));
      aiMeta.repairRound = true;
      aiMeta.latencyMs += repair.latencyMs;
      aiMeta.attempts += repair.attempts;
      const retried = evaluateAnswer(repair.data, facts);
      const failedKeys = new Set(failed.map((c) => c.key));
      const fixed = retried.accepted.filter((c) => failedKeys.has(c.key));
      const fixedKeys = new Set(fixed.map((c) => c.key));
      accepted = [...accepted, ...fixed];
      failed = failed.filter((c) => !fixedKeys.has(c.key));
    } catch {
      // The first answer's valid proposals are still usable; failed ones stay blocked.
    }
  }

  const changes = [];
  const blocked = failed.map((c) => ({
    key: c.key,
    target: c.target,
    original: c.original,
    proposed: c.text,
    issues: c.validation.issues.filter((i) => i.severity === 'error'),
  }));

  const toChange = (c, type) => ({
    changeId: c.key,
    type,
    target: c.target,
    original: c.original,
    proposed: c.text,
    explanation: c.rationale || 'Reworded for this job.',
    evidence: evidenceView(facts, c.target.type === 'bullet' ? [`exp.${c.target.roleIndex + 1}.${c.target.bulletIndex + 1}`, ...c.evidenceIds] : c.evidenceIds),
    evidenceIds: c.evidenceIds,
    targetedKeywords: cleanTargets(c.targetedKeywords, c.text, facts),
    validation: c.validation,
  });

  const summary = accepted.find((c) => c.key === 'summary');
  if (summary) changes.push(toChange(summary, 'summary'));

  const skills = proposeSkillsOrder(facts);
  if (skills) {
    changes.push({
      changeId: 'skills-order',
      type: 'skills_order',
      target: { type: 'skills' },
      original: resume.technicalSkills.map((g) => ({ category: g.category, items: g.items })),
      proposed: skills.categoryOrder.map((gi) => ({ category: resume.technicalSkills[gi].category, items: skills.itemOrders[gi].map((ii) => resume.technicalSkills[gi].items[ii]) })),
      order: { categoryOrder: skills.categoryOrder, itemOrders: skills.itemOrders },
      explanation: skills.explanation,
      evidence: [],
      targetedKeywords: [],
      validation: { passed: true, issues: [] },
    });
  }

  const bulletOrders = new Map(proposeBulletOrders(facts).map((o) => [o.roleIndex, o]));
  resume.experience.forEach((role, r) => {
    const order = bulletOrders.get(r);
    if (order) {
      changes.push({
        changeId: `order-${r + 1}`,
        type: 'bullet_order',
        target: { type: 'bullet_order', roleIndex: r },
        original: role.bullets.map((_, i) => i),
        proposed: order.order,
        order: { bulletOrder: order.order },
        explanation: order.explanation,
        evidence: [],
        targetedKeywords: [],
        validation: { passed: true, issues: [] },
      });
    }
    accepted
      .filter((c) => c.target.type === 'bullet' && c.target.roleIndex === r)
      .sort((a, b) => a.target.bulletIndex - b.target.bulletIndex)
      .forEach((c) => changes.push(toChange(c, 'bullet')));
  });

  return {
    changes,
    blocked,
    ai: aiMeta,
    gaps: facts.gaps.map((g) => ({ keyword: g.keyword, importance: g.importance, classification: g.classification, relatedSkills: g.relatedSkills ?? [], explanation: g.explanation })),
  };
}
