import { AlertTriangle, Ban, CheckCircle2, FileWarning } from 'lucide-react';
import { CLASS_META } from '../job-analysis/classification';
import { IssueList } from './ChangeCard';

export function CoveragePanel({ coverage }) {
  const supported = coverage.items.filter((i) => i.supported);
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="coverage-heading">
      <h2 id="coverage-heading" className="font-semibold text-slate-900">
        Keyword coverage
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Job keywords your resume already evidences that appear in the job’s own wording:{' '}
        <span className="font-semibold text-slate-900">
          {coverage.literalBefore} → {coverage.literalAfter}
        </span>{' '}
        of {coverage.supportedKeywords}.
      </p>
      <ul className="mt-3 flex flex-wrap gap-1.5">
        {supported.map((i) => (
          <li
            key={i.keyword}
            title={i.after ? (i.before ? 'Already worded this way' : 'Now uses the job’s wording') : 'Evidenced, but worded differently'}
            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
              i.after && !i.before ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : i.after ? 'border-slate-200 bg-slate-50 text-slate-700' : 'border-dashed border-slate-300 text-slate-500'
            }`}
          >
            {i.keyword}
            {i.after && !i.before && ' ↑'}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-slate-500">{coverage.note} The evidence-based match from the analysis does not change.</p>
    </section>
  );
}

export function GapsPanel({ gaps }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="gaps-heading">
      <h2 id="gaps-heading" className="flex items-center gap-2 font-semibold text-slate-900">
        <Ban className="h-4 w-4 text-slate-500" aria-hidden="true" /> Gaps (not added)
      </h2>
      {gaps.length ? (
        <ul className="mt-2 space-y-1.5 text-sm">
          {gaps.map((g) => (
            <li key={g.keyword} className="flex flex-wrap items-baseline gap-x-2">
              <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${CLASS_META[g.classification].chip}`}>{g.keyword}</span>
              <span className="text-slate-600">
                {g.relatedSkills?.length ? `not in your master resume (you have ${g.relatedSkills.join(', ')}, which is not the same)` : 'not in your master resume'}
                {g.importance === 'must_have' && <span className="font-medium text-red-700"> · must-have</span>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-slate-500">No gaps: every job keyword is evidenced.</p>
      )}
      <p className="mt-3 text-xs text-slate-500">Gaps are never added to improve the match. If one is genuinely part of your experience, add it to your master resume and run a new analysis.</p>
    </section>
  );
}

export function LayoutPanel({ layout }) {
  const ok = layout.passed;
  return (
    <section className={`rounded-xl border p-5 shadow-sm ${ok ? 'border-slate-200 bg-white' : 'border-red-200 bg-red-50'}`} aria-labelledby="layout-heading">
      <h2 id="layout-heading" className="flex items-center gap-2 font-semibold text-slate-900">
        {ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" /> : <FileWarning className="h-4 w-4 text-red-600" aria-hidden="true" />} Layout check
      </h2>
      <p className="mt-1 text-sm text-slate-700">
        {layout.pageCount} page{layout.pageCount === 1 ? '' : 's'} (master: {layout.pageCountBefore}, maximum {layout.maxPages}) · last page {Math.round(layout.lastPageFill * 100)}% full
      </p>
      {layout.errors.length > 0 && <IssueList tone="red" issues={layout.errors.map((message) => ({ message }))} />}
      {layout.grownParagraphs.length > 0 && (
        <div className="mt-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> {layout.grownParagraphs.length} paragraph(s) now take an extra line:
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-slate-600">
            {layout.grownParagraphs.map((g, i) => (
              <li key={i}>
                “{g.text}…” {g.linesBefore} → {g.linesAfter} lines
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function BlockedPanel({ blocked }) {
  if (!blocked.length) return null;
  return (
    <details className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-slate-800 hover:bg-slate-50">
        {blocked.length} AI suggestion{blocked.length === 1 ? ' was' : 's were'} blocked by the fact checker (not offered)
      </summary>
      <ul className="space-y-3 border-t border-slate-200 px-5 py-3">
        {blocked.map((b) => (
          <li key={b.key} className="space-y-1.5 text-sm">
            <p className="text-slate-500">
              <span className="font-medium text-slate-700">Original:</span> {b.original}
            </p>
            <p className="text-slate-500 line-through decoration-red-300">{b.proposed}</p>
            <IssueList tone="red" issues={b.issues} />
          </li>
        ))}
      </ul>
    </details>
  );
}
