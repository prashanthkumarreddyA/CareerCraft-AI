import { CLASS_META, CLASSIFICATIONS } from './classification';

export function ClassificationLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600" aria-label="Legend">
      {CLASSIFICATIONS.map((c) => (
        <li key={c} className="inline-flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${CLASS_META[c].dot}`} aria-hidden="true" />
          {CLASS_META[c].label}
        </li>
      ))}
    </ul>
  );
}

function KeywordChip({ keyword }) {
  const meta = CLASS_META[keyword.classification];
  return (
    <li>
      <a
        href={`#req-${encodeURIComponent(keyword.keyword)}`}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium hover:shadow-sm ${meta.chip}`}
        title={`${meta.label}${keyword.normalizedName !== keyword.keyword ? ` · ${keyword.normalizedName}` : ''}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
        {keyword.keyword}
        <span className="sr-only"> ({meta.label})</span>
      </a>
    </li>
  );
}

const ROWS = [
  ['mustHave', 'Must-have keywords'],
  ['preferred', 'Preferred keywords'],
  ['optional', 'Optional keywords'],
];

export default function KeywordGroups({ keywordAnalysis }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="keywords-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="keywords-heading" className="font-semibold text-slate-900">
          Keywords from the job description
        </h2>
        <ClassificationLegend />
      </div>
      <div className="mt-4 space-y-4">
        {ROWS.map(([key, label]) => (
          <div key={key}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {label} <span className="font-normal normal-case">({keywordAnalysis[key].length})</span>
            </h3>
            {keywordAnalysis[key].length ? (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {keywordAnalysis[key].map((k) => (
                  <KeywordChip key={k.keyword} keyword={k} />
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-slate-400">None in this job description.</p>
            )}
          </div>
        ))}
      </div>
      {keywordAnalysis.totals.duplicatesMerged > 0 && (
        <p className="mt-4 text-xs text-slate-500">
          {keywordAnalysis.totals.duplicatesMerged} duplicate or alternative spelling{keywordAnalysis.totals.duplicatesMerged === 1 ? ' was' : 's were'} merged.
        </p>
      )}
    </section>
  );
}
