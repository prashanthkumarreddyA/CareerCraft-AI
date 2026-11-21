/**
 * Meaning checks that go beyond names and numbers: what the candidate DID (action), and who the
 * candidate IS (professional identity). Conservative by design: when the checker cannot
 * establish that a rewrite keeps the original meaning, it flags it for manual review
 * (severity "review") instead of letting it pass silently.
 *
 *  MEANING_CHANGED (review)     the rewrite uses a kind of action the original does not
 *                               (built → optimized, implemented → designed, developed → led)
 *  UNVERIFIED_ACTION (review)   a bullet starts with a verb the checker does not know
 *  OWNERSHIP_INFLATED (error)   "contributed to / assisted / helped" became sole ownership
 *  ACTION_REMOVED (warning)     an action the original states is no longer mentioned
 *  IDENTITY_CHANGED (error)     the summary no longer presents the locked professional identity
 *  DESIGNATION_ADDED (error)    a job title/designation the resume does not use
 */

// Kinds of action. Words in the same class are treated as the same meaning
// (built = developed = implemented); a word from a new class is a change of meaning.
const ACTION_CLASSES = {
  create: [
    'build', 'built', 'builds', 'building', 'develop', 'developed', 'develops', 'developing', 'implement', 'implemented',
    'implements', 'implementing', 'create', 'created', 'creates', 'creating', 'engineered', 'code', 'coded', 'coding',
    'wrote', 'written', 'establish', 'established', 'introduce', 'introduced', 'launch', 'launched', 'deliver',
    'delivered', 'delivers', 'delivering', 'construct', 'constructed', 'produce', 'produced', 'set up', 'setting up',
  ],
  design: ['design', 'designed', 'designs', 'designing', 'modeled', 'modelled', 'modeling', 'modelling', 'planned', 'defined'],
  improve: [
    'optimize', 'optimized', 'optimizes', 'optimizing', 'optimise', 'optimised', 'optimises', 'optimising', 'optimization',
    'optimisation', 'improve', 'improved', 'improves', 'improving', 'enhance', 'enhanced', 'enhances', 'enhancing',
    'refactor', 'refactored', 'refactoring', 'streamline', 'streamlined', 'streamlining', 'accelerate', 'accelerated',
    'accelerating', 'boost', 'boosted', 'boosting', 'tune', 'tuned', 'tuning', 'reduce', 'reduced', 'reduces', 'reducing',
    'increase', 'increased', 'increasing', 'modernize', 'modernized', 'modernised', 'upgrade', 'upgraded', 'upgrading',
    'scaled', 'scaling', 'sped up', 'speed up',
  ],
  integrate: ['integrate', 'integrated', 'integrates', 'integrating', 'integration', 'integrations', 'connected', 'connecting'],
  automate: ['automate', 'automated', 'automates', 'automating', 'automation'],
  deploy: [
    'deploy', 'deployed', 'deploys', 'deploying', 'deployment', 'deployments', 'release', 'released', 'releasing', 'ship',
    'shipped', 'shipping', 'migrate', 'migrated', 'migrating', 'migration', 'configure', 'configured', 'configuring',
    'provisioned', 'provisioning', 'containerized', 'containerised', 'hosted',
  ],
  maintain: [
    'maintain', 'maintained', 'maintains', 'maintaining', 'maintenance', 'fix', 'fixed', 'fixing', 'debug', 'debugged',
    'debugging', 'troubleshoot', 'troubleshot', 'troubleshooting', 'resolve', 'resolved', 'resolving', 'monitor',
    'monitored', 'monitoring',
  ],
  test: ['tested', 'testing', 'validated', 'validating', 'verified', 'verifying'],
  analyze: [
    'analyze', 'analyzed', 'analyzing', 'analyse', 'analysed', 'analysing', 'investigate', 'investigated', 'investigating',
    'researched', 'evaluate', 'evaluated', 'evaluating', 'assessed', 'audited',
  ],
  document: ['documented', 'documenting'],
  collaborate: ['collaborate', 'collaborated', 'collaborates', 'collaborating', 'partnered', 'coordinated', 'coordinating', 'worked with', 'working with', 'works with', 'worked closely'],
  assist: [
    'contribute', 'contributed', 'contributes', 'contributing', 'assist', 'assisted', 'assisting', 'help', 'helped',
    'helping', 'participate', 'participated', 'participating', 'supported', 'supporting',
  ],
  lead: [
    'lead', 'led', 'leads', 'leading', 'manage', 'managed', 'manages', 'managing', 'directed', 'directing', 'owned',
    'owning', 'oversaw', 'oversee', 'oversees', 'overseeing', 'supervised', 'supervising', 'headed', 'spearheaded',
    'spearheading', 'drove', 'driving', 'mentored', 'mentoring', 'architect', 'architected', 'architecting',
  ],
  outcome: ['resulting in', 'resulted in', 'leading to', 'ensuring', 'ensured', 'enabling', 'enabled', 'allowing', 'achieving', 'achieved', 'saving', 'saved'],
};

const CLASS_LABEL = {
  create: 'building/developing',
  design: 'designing',
  improve: 'optimising/improving',
  integrate: 'integrating',
  automate: 'automating',
  deploy: 'deploying/migrating',
  maintain: 'maintaining/fixing',
  test: 'testing',
  analyze: 'analysing',
  document: 'documenting',
  collaborate: 'collaborating',
  assist: 'contributing/assisting',
  lead: 'leading/managing',
  outcome: 'a result or outcome',
};

const PHRASES = [];
const WORDS = new Map();
for (const [cls, list] of Object.entries(ACTION_CLASSES)) {
  for (const w of list) (w.includes(' ') ? PHRASES.push([w, cls]) : WORDS.set(w, cls));
}
PHRASES.sort((a, b) => b[0].length - a[0].length);

/** Map of action class → words found ("Built and optimized" → create:[built], improve:[optimized]). */
export function actionClassesIn(text) {
  let rest = ` ${String(text ?? '').toLowerCase().replace(/[^a-z\s-]/g, ' ')} `;
  const found = new Map();
  const add = (cls, w) => found.set(cls, [...(found.get(cls) ?? []), w]);
  for (const [phrase, cls] of PHRASES) {
    const re = new RegExp(`(?<=\\s)${phrase.replace(/ /g, '\\s+')}(?=\\s)`, 'g');
    if (re.test(rest)) {
      add(cls, phrase);
      rest = rest.replace(re, ' ');
    }
  }
  for (const w of rest.split(/[\s-]+/)) if (WORDS.has(w)) add(WORDS.get(w), w);
  return found;
}

export const isKnownActionWord = (word) => WORDS.has(String(word).toLowerCase());

const firstWord = (text) => (String(text ?? '').trim().match(/^[A-Za-z]+/)?.[0] ?? '').toLowerCase();

const issue = (code, message, severity) => ({ code, message, severity });

/**
 * Compares what the rewrite says the candidate did with what the original (plus, for the
 * summary, the cited evidence) says.
 * @param {{ text, original, target, evidenceText }} p
 */
export function checkMeaning({ text, original, target, evidenceText = '', leadershipReported = false }) {
  const issues = [];
  if (!original || !text) return issues;
  const before = actionClassesIn(original);
  // The summary aggregates the whole resume, so cited evidence may supply an action; a bullet
  // must keep the meaning of ITS original (another bullet's action is not this bullet's).
  const reference = target.type === 'summary' ? actionClassesIn(`${original}\n${evidenceText}`) : before;
  const after = actionClassesIn(text);

  const added = [...after.keys()].filter((cls) => !reference.has(cls) && cls !== 'lead');
  // Leadership words are reported as INFLATED_ROLE when the evidence lacks them; when the
  // evidence has them but the original text did not, the meaning still changed.
  if (after.has('lead') && !before.has('lead') && !leadershipReported) added.push('lead');
  if (added.length) {
    const what = added.map((cls) => `${CLASS_LABEL[cls]} (“${after.get(cls)[0]}”)`).join(', ');
    issues.push(issue('MEANING_CHANGED', `Describes a different kind of work than the original: ${what}. Check that this is what you actually did.`, 'review'));
  }

  if (before.has('assist') && !after.has('assist') && ['create', 'design', 'improve', 'lead', 'automate', 'integrate', 'deploy'].some((c) => after.has(c))) {
    issues.push(issue('OWNERSHIP_INFLATED', `The original says you ${before.get('assist')[0]} the work; the new text presents it as your own.`, 'error'));
  }

  if (target.type === 'bullet') {
    const lead = firstWord(text);
    if (lead && lead !== firstWord(original) && !isKnownActionWord(lead)) {
      issues.push(issue('UNVERIFIED_ACTION', `Starts with “${lead}”, which the checker cannot compare with the original “${firstWord(original)}”. Check that the meaning is unchanged.`, 'review'));
    }
  }

  const removed = [...before.keys()].filter((cls) => !after.has(cls) && cls !== 'assist');
  if (removed.length) issues.push(issue('ACTION_REMOVED', `No longer mentions ${removed.map((c) => CLASS_LABEL[c]).join(', ')} from the original.`, 'warning'));
  return issues;
}

/* ---------------------------------------------------------------- identity --------------- */

const ROLE_NOUN = 'developer|engineer|architect|designer|programmer|consultant|analyst|administrator|scientist|specialist|tester|technologist';
const STOP = new Set([
  'a', 'an', 'the', 'with', 'and', 'or', 'as', 'of', 'for', 'to', 'by', 'in', 'on', 'at', 'is', 'am', 'was', 'other',
  'team', 'teams', 'experienced', 'skilled', 'proven', 'passionate', 'motivated', 'dedicated', 'highly', 'years', 'year',
  'experience', 'worked', 'working', 'works', 'alongside', 'between', 'product', 'cross', 'functional',
]);

const NOT_SELF = new Set(['with', 'alongside', 'for', 'among', 'between', 'other', 'and', 'to', 'by', 'the']);

export const normalizeDesignation = (s) => String(s ?? '').toLowerCase().replace(/[-_/]+/g, ' ').replace(/[^a-z0-9+#. ]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Designations the text uses for the candidate: a role noun near the start of a sentence or
 * after "as (a/an)", with up to three qualifying words before it ("Full Stack Developer").
 */
export function designationsIn(text) {
  const out = [];
  for (const sentence of String(text ?? '').split(/(?<=[.!?|•·])\s+|\s+[|•·]\s+/)) {
    const tokens = sentence.split(/\s+/).filter(Boolean);
    tokens.forEach((tok, i) => {
      // Singular only: "developers"/"engineers" are other people, not the candidate.
      if (!new RegExp(`^(?:${ROLE_NOUN})[,.;:]?$`, 'i').test(tok)) return;
      const qualifiers = [];
      let j = i - 1;
      for (; j >= 0 && qualifiers.length < 3; j--) {
        const w = tokens[j].replace(/[,;:]+$/, '');
        if (STOP.has(w.toLowerCase()) || /[,;:]$/.test(tokens[j]) || /^\d/.test(w)) break;
        qualifiers.unshift(w);
      }
      const before = (tokens[j] ?? '').toLowerCase();
      if (NOT_SELF.has(before)) return; // "worked with a QA engineer", "built for the data analyst"
      const selfReference = i <= 5 || ['as'].includes(before) || (['a', 'an'].includes(before) && (tokens[j - 1] ?? '').toLowerCase() === 'as');
      if (!selfReference) return;
      out.push(normalizeDesignation([...qualifiers, tok.replace(/[,.;:]+$/, '')].join(' ')));
    });
  }
  return out;
}

/**
 * The candidate's professional identity, locked during tailoring: the designation the headline
 * starts with ("Full Stack Developer | …"), else the first one in the summary.
 */
export function professionalIdentity(resume) {
  const headlineFirst = String(resume?.headline ?? '').split(/\s*[|•·,]\s*|\s+[-–—]\s+/)[0];
  const fromHeadline = designationsIn(headlineFirst)[0];
  if (fromHeadline) return fromHeadline;
  return designationsIn(resume?.summary)[0] ?? null;
}

const endsWithPhrase = (designation, phrase) => designation === phrase || designation.endsWith(` ${phrase}`);

/** Identity + designation checks. `allowed` = designations the resume itself uses. */
export function checkIdentity({ text, original, target, identity, allowedDesignations }) {
  const issues = [];
  if (target.type !== 'summary') return issues; // bullets describe work, not who the candidate is
  const used = designationsIn(text);
  if (identity) {
    const startsWithIdentity = designationsIn(original)[0] && endsWithPhrase(designationsIn(original)[0], identity);
    const keeps = used.some((d) => endsWithPhrase(d, identity));
    const leadsWith = used[0] && endsWithPhrase(used[0], identity);
    if (!keeps || (startsWithIdentity && !leadsWith)) {
      issues.push(issue('IDENTITY_CHANGED', `Your professional identity “${titleCase(identity)}” is locked: the summary must present you as a ${titleCase(identity)}${startsWithIdentity ? ', first' : ''}.`, 'error'));
    }
  }
  const allowed = new Set([...(allowedDesignations ?? []), ...designationsIn(original)]);
  const extra = [...new Set(used)].filter((d) => ![...allowed].some((a) => endsWithPhrase(d, a)));
  if (extra.length) issues.push(issue('DESIGNATION_ADDED', `Uses a designation your resume does not: ${extra.map(titleCase).join(', ')}.`, 'error'));
  return issues;
}

const titleCase = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
