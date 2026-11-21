import { Info } from 'lucide-react';
import { CLASS_META, scoreTone } from './classification';

function ScoreRing({ value }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const tone = scoreTone(value);
  return (
    <div className="relative h-36 w-36 shrink-0">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="60" cy="60" r={radius} className="fill-none stroke-slate-100" strokeWidth="12" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          className={`fill-none ${tone.ring} transition-[stroke-dashoffset] duration-700`}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - value / 100)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-3xl font-semibold ${tone.text}`}>{value}%</span>
        <span className="text-xs text-slate-500">resume match</span>
      </div>
    </div>
  );
}

function Stat({ label, value, dot }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2">
      <dt className="flex items-center gap-1.5 text-xs text-slate-500">
        {dot && <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />}
        {label}
      </dt>
      <dd className="mt-0.5 text-lg font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

export default function MatchScoreCard({ score }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="score-heading">
      <h2 id="score-heading" className="sr-only">
        Match score
      </h2>
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
        <ScoreRing value={score.matchPercentage} />
        <div className="min-w-0 flex-1 space-y-3">
          <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Stat label="Requirements" value={score.totalRequirements} />
            <Stat label="Matched" value={score.matchedRequirements} dot={CLASS_META.DIRECT_MATCH.dot} />
            <Stat label="Partially supported" value={score.partiallySupportedRequirements} dot={CLASS_META.RELATED_EXPERIENCE.dot} />
            <Stat label="Missing" value={score.missingRequirements} dot={CLASS_META.MISSING.dot} />
          </dl>
          {score.mustHaveCoverage !== null && (
            <p className="text-sm text-slate-700">
              <span className="font-medium">{score.mustHaveCoverage}%</span> of must-have skills are matched or supported by experience.
              {score.mustHaveMissing.length > 0 && <span className="text-slate-500"> Missing must-haves: {score.mustHaveMissing.join(', ')}.</span>}
            </p>
          )}
          <p className="flex gap-1.5 text-xs text-slate-500">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {score.disclaimer}
          </p>
        </div>
      </div>

      <details className="group mt-4 rounded-lg border border-slate-200">
        <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium text-brand-800 hover:bg-slate-50">How this score is calculated</summary>
        <div className="space-y-3 border-t border-slate-200 px-4 py-3 text-sm">
          <p className="text-slate-600">{score.formula}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-1.5 pr-4 font-medium">Group</th>
                  <th className="py-1.5 pr-4 font-medium">Items</th>
                  <th className="py-1.5 pr-4 font-medium">Coverage</th>
                  <th className="py-1.5 pr-4 font-medium">Weight</th>
                  <th className="py-1.5 font-medium">Share of score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {score.breakdown.map((b) => (
                  <tr key={b.group} className={b.included ? '' : 'text-slate-400'}>
                    <td className="py-1.5 pr-4">{b.label}</td>
                    <td className="py-1.5 pr-4">{b.items}</td>
                    <td className="py-1.5 pr-4">{b.included ? `${b.coverage}%` : 'not in this job'}</td>
                    <td className="py-1.5 pr-4">{b.weight}</td>
                    <td className="py-1.5">{b.included ? `${b.effectiveWeight}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>
    </section>
  );
}
