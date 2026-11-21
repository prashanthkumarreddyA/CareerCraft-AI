// Display metadata shared by every job-analysis component.
export const CLASSIFICATIONS = ['DIRECT_MATCH', 'EXPERIENCE_SUPPORTED', 'RELATED_EXPERIENCE', 'MISSING'];

export const CLASS_META = {
  DIRECT_MATCH: {
    label: 'Direct match',
    plural: 'Direct matches',
    description: 'Named in your master resume.',
    chip: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    dot: 'bg-emerald-500',
    text: 'text-emerald-700',
  },
  EXPERIENCE_SUPPORTED: {
    label: 'Supported by experience',
    plural: 'Supported by experience',
    description: 'Not named as a keyword, but your described experience shows it.',
    chip: 'border-sky-200 bg-sky-50 text-sky-800',
    dot: 'bg-sky-500',
    text: 'text-sky-700',
  },
  RELATED_EXPERIENCE: {
    label: 'Related experience',
    plural: 'Related experience',
    description: 'You have a similar but different skill. The requirement itself is not claimed.',
    chip: 'border-amber-200 bg-amber-50 text-amber-800',
    dot: 'bg-amber-500',
    text: 'text-amber-700',
  },
  MISSING: {
    label: 'Missing',
    plural: 'Missing',
    description: 'Not found in your master resume.',
    chip: 'border-slate-300 bg-white text-slate-600',
    dot: 'bg-slate-400',
    text: 'text-slate-600',
  },
};

export const IMPORTANCE_LABELS = { must_have: 'Must-have', preferred: 'Preferred', optional: 'Optional' };

export const CATEGORY_LABELS = {
  language: 'Language',
  frontend: 'Frontend',
  backend: 'Backend',
  framework: 'Framework',
  database: 'Database',
  cloud: 'Cloud',
  devops: 'DevOps',
  api: 'API',
  architecture: 'Architecture',
  security: 'Security',
  testing: 'Testing',
  tool: 'Tool',
  methodology: 'Methodology',
  other: 'Other',
};

export const GROUP_TITLES = {
  languages: 'Languages',
  frontend: 'Frontend',
  backend: 'Backend',
  frameworks: 'Frameworks',
  databases: 'Databases',
  cloud: 'Cloud',
  devops: 'DevOps',
  apis: 'APIs',
  architecture: 'Architecture',
  security: 'Security',
  testing: 'Testing',
  tools: 'Tools',
  methodologies: 'Methodologies',
  other: 'Other',
};

export function scoreTone(percentage) {
  if (percentage >= 75) return { ring: 'stroke-emerald-500', text: 'text-emerald-700' };
  if (percentage >= 50) return { ring: 'stroke-sky-500', text: 'text-sky-700' };
  if (percentage >= 30) return { ring: 'stroke-amber-500', text: 'text-amber-700' };
  return { ring: 'stroke-slate-400', text: 'text-slate-700' };
}
