import { useState } from 'react';
import { Check, RotateCcw, X } from 'lucide-react';
import { DecisionBadge } from './ChangeCard';

const btn = 'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50';

function SkillsColumn({ groups }) {
  return (
    <ol className="space-y-1 text-sm text-slate-800">
      {groups.map((g) => (
        <li key={g.category}>
          <span className="font-semibold">{g.category}:</span> {g.items.join(', ')}
        </li>
      ))}
    </ol>
  );
}

function BulletColumn({ bullets }) {
  return (
    <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-800">
      {bullets.map((b, i) => (
        <li key={i}>{b}</li>
      ))}
    </ol>
  );
}

/** Re-ordering only (skills or a role's bullets): nothing is added, removed or reworded. */
export default function OrderChangeCard({ change, title, bullets, readOnly, onDecide }) {
  const [busy, setBusy] = useState(false);
  const run = async (body) => {
    setBusy(true);
    try {
      await onDecide(change.changeId, body);
    } finally {
      setBusy(false);
    }
  };
  const isSkills = change.type === 'skills_order';
  return (
    <article className="rounded-xl border border-slate-200 bg-white shadow-sm" aria-label={title}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
        <DecisionBadge change={change} />
      </header>
      <div className="grid gap-4 p-4 md:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Original order</p>
          {isSkills ? <SkillsColumn groups={change.original} /> : <BulletColumn bullets={bullets} />}
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Proposed order</p>
          {isSkills ? <SkillsColumn groups={change.proposed} /> : <BulletColumn bullets={change.proposed.map((i) => bullets[i])} />}
        </div>
      </div>
      <div className="space-y-3 border-t border-slate-100 px-4 py-3">
        <p className="text-sm text-slate-700">
          <span className="font-medium">Why: </span>
          {change.explanation}
        </p>
        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || change.decision === 'accepted'} onClick={() => run({ decision: 'accept' })} className={`${btn} border-emerald-600 text-emerald-700 hover:bg-emerald-50`}>
              <Check className="h-4 w-4" aria-hidden="true" /> Accept order
            </button>
            <button type="button" disabled={busy || change.decision === 'rejected'} onClick={() => run({ decision: 'reject' })} className={`${btn} border-slate-300 text-slate-700 hover:bg-slate-50`}>
              <X className="h-4 w-4" aria-hidden="true" /> Keep original order
            </button>
            {change.decision !== 'pending' && (
              <button type="button" disabled={busy} onClick={() => run({ decision: 'reset' })} className={`${btn} border-transparent text-slate-500 hover:bg-slate-50`}>
                <RotateCcw className="h-4 w-4" aria-hidden="true" /> Undo
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
