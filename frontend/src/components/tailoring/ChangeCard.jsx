import { useState } from 'react';
import { AlertTriangle, Check, Eye, Loader2, Pencil, RotateCcw, ShieldAlert, X } from 'lucide-react';
import { wordDiff } from '../../utils/wordDiff';
import { EvidenceList } from '../job-analysis/RequirementGroups';

export const DECISION_META = {
  pending: { label: 'Needs decision', className: 'bg-amber-50 text-amber-800 border-amber-200' },
  accepted: { label: 'Accepted', className: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  rejected: { label: 'Kept original', className: 'bg-slate-100 text-slate-700 border-slate-200' },
  edited: { label: 'Your edit', className: 'bg-sky-50 text-sky-800 border-sky-200' },
};

export function DecisionBadge({ change }) {
  const meta = DECISION_META[change.decision];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${meta.className}`}>
      {change.override?.confirmed && <ShieldAlert className="h-3 w-3" aria-hidden="true" />}
      {meta.label}
      {change.override?.confirmed && ' (override)'}
      {!change.override?.confirmed && change.review?.confirmed && ' (reviewed)'}
    </span>
  );
}

function Diff({ parts, mode }) {
  return (
    <p className="text-sm leading-relaxed text-slate-800">
      {parts.map((p, i) =>
        p[mode] ? (
          <mark key={i} className={mode === 'added' ? 'rounded bg-emerald-100 text-emerald-900' : 'rounded bg-red-100 text-red-900 line-through decoration-red-400'}>
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </p>
  );
}

export function IssueList({ issues, tone = 'amber' }) {
  if (!issues?.length) return null;
  const colors = tone === 'red' ? 'border-red-200 bg-red-50 text-red-900' : 'border-amber-200 bg-amber-50 text-amber-900';
  return (
    <ul className={`space-y-0.5 rounded-md border px-3 py-2 text-xs ${colors}`}>
      {issues.map((i, n) => (
        <li key={n} className="flex gap-1.5">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          <span>
            {i.message}
            {i.severity === 'warning' && <span className="text-amber-700"> (note)</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Possible change of meaning: shown prominently, accepted only with an explicit confirmation. */
function ReviewPanel({ issues, checked, onChange, id }) {
  if (!issues?.length) return null;
  return (
    <div className="space-y-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-950">
      <p className="flex items-center gap-1.5 font-semibold">
        <Eye className="h-3.5 w-3.5" aria-hidden="true" /> Needs your review: the checker could not confirm the meaning is unchanged
      </p>
      <ul className="list-disc space-y-0.5 pl-5">
        {issues.map((i, n) => (
          <li key={n}>{i.message}</li>
        ))}
      </ul>
      {onChange && (
        <label className="flex items-start gap-2 text-sm text-slate-800" htmlFor={id}>
          <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1" />I compared it with the original: it still describes what I actually did. This is recorded with the version.
        </label>
      )}
    </div>
  );
}

const btn = 'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50';

/** Summary / bullet text change: original | proposed, explanation, evidence, and decisions. */
export default function ChangeCard({ change, title, readOnly, onDecide }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [editIssues, setEditIssues] = useState(null); // issues returned by the server for the current draft
  const [confirm, setConfirm] = useState(false);
  const [reviewChecked, setReviewChecked] = useState(false); // accepting a proposal flagged for review
  const [editReviewChecked, setEditReviewChecked] = useState(false);

  const shown = change.decision === 'edited' ? change.editedText : change.proposed;
  const diff = wordDiff(change.original, shown);
  const current = (change.decision === 'edited' ? change.editValidation : change.validation)?.issues ?? [];
  const warnings = current.filter((i) => i.severity === 'warning');
  const reviewIssues = current.filter((i) => i.severity === 'review');
  const needsReview = change.decision !== 'edited' && reviewIssues.length > 0;
  const editErrors = editIssues?.filter((i) => i.severity === 'error') ?? [];
  const editReviews = editIssues?.filter((i) => i.severity === 'review') ?? [];
  const editBlocked = (editErrors.length > 0 && !confirm) || (editReviews.length > 0 && !editReviewChecked);

  async function run(body) {
    setBusy(true);
    try {
      const result = await onDecide(change.changeId, body);
      if (result?.claimIssues) {
        setEditIssues(result.claimIssues);
        setConfirm(false);
        setEditReviewChecked(false);
        return;
      }
      if (result?.ok) {
        setEditing(false);
        setEditIssues(null);
        setConfirm(false);
        setEditReviewChecked(false);
        setReviewChecked(false);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="rounded-xl border border-slate-200 bg-white shadow-sm" aria-label={title}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
        <DecisionBadge change={change} />
      </header>
      <div className="grid gap-4 p-4 md:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Original</p>
          <Diff parts={diff.before} mode="removed" />
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{change.decision === 'edited' ? 'Your edit' : 'Proposed'}</p>
          <Diff parts={diff.after} mode="added" />
        </div>
      </div>
      <div className="space-y-3 border-t border-slate-100 px-4 py-3">
        <p className="text-sm text-slate-700">
          <span className="font-medium">Why: </span>
          {change.explanation}
        </p>
        {change.targetedKeywords?.length > 0 && (
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
            Job keywords:
            {change.targetedKeywords.map((k) => (
              <span key={k} className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800">
                {k}
              </span>
            ))}
          </p>
        )}
        <details>
          <summary className="cursor-pointer text-xs font-medium text-brand-800">Evidence from your master resume ({change.evidence.length})</summary>
          <div className="mt-2">
            <EvidenceList evidence={change.evidence} />
          </div>
        </details>
        {change.review?.confirmed && ['accepted', 'edited'].includes(change.decision) ? (
          <div className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-950">
            <p className="font-medium">You reviewed the meaning of this text (recorded {new Date(change.review.confirmedAt).toLocaleString()}):</p>
            <ul className="mt-1 list-disc pl-4">
              {change.review.issues.map((i, n) => (
                <li key={n}>{i.message}</li>
              ))}
            </ul>
          </div>
        ) : (
          <ReviewPanel issues={needsReview && !editing ? reviewIssues : null} checked={reviewChecked} onChange={readOnly || change.decision === 'accepted' ? null : setReviewChecked} id={`review-${change.changeId}`} />
        )}
        <IssueList issues={warnings} />
        {change.override?.confirmed && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
            <p className="font-medium">You confirmed this edit despite these checks (recorded {new Date(change.override.confirmedAt).toLocaleString()}):</p>
            <ul className="mt-1 list-disc pl-4">
              {change.override.issues.map((i, n) => (
                <li key={n}>{i.message}</li>
              ))}
            </ul>
          </div>
        )}

        {editing && (
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor={`edit-${change.changeId}`}>
              Your wording
            </label>
            <textarea
              id={`edit-${change.changeId}`}
              rows={change.type === 'summary' ? 5 : 3}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setEditIssues(null);
                setConfirm(false);
                setEditReviewChecked(false);
              }}
              className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
            />
            {editErrors.length > 0 && (
              <div className="space-y-2">
                <IssueList issues={editErrors} tone="red" />
                <p className="text-xs text-slate-600">
                  These statements are not supported by your master resume. If they are true, the better fix is to add them to your master resume and run a new analysis. You can still use this wording for this version only:
                </p>
                <label className="flex items-start gap-2 text-sm text-slate-800">
                  <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-1" />I confirm this wording is accurate and want to use it anyway. This is recorded with the version.
                </label>
              </div>
            )}
            <ReviewPanel issues={editReviews} checked={editReviewChecked} onChange={setEditReviewChecked} id={`edit-review-${change.changeId}`} />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || !draft.trim() || (editIssues && editBlocked)}
                onClick={() => run({ decision: 'edit', text: draft, ...(editErrors.length ? { confirmOverride: true } : {}), ...(editReviews.length ? { confirmReview: true } : {}) })}
                className={`${btn} border-brand-800 bg-brand-800 text-white hover:bg-brand-900`}
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {editErrors.length ? 'Use my wording anyway' : 'Save my wording'}
              </button>
              <button type="button" disabled={busy} onClick={() => (setEditing(false), setEditIssues(null))} className={`${btn} border-slate-300 text-slate-700 hover:bg-slate-50`}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {!readOnly && !editing && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || change.decision === 'accepted' || change.validation?.passed === false || (needsReview && !reviewChecked)}
              title={needsReview && !reviewChecked ? 'Review the meaning above first' : undefined}
              onClick={() => run({ decision: 'accept', ...(needsReview ? { confirmReview: true } : {}) })}
              className={`${btn} border-emerald-600 text-emerald-700 hover:bg-emerald-50`}
            >
              <Check className="h-4 w-4" aria-hidden="true" /> {needsReview ? 'Accept after review' : 'Accept'}
            </button>
            <button type="button" disabled={busy || change.decision === 'rejected'} onClick={() => run({ decision: 'reject' })} className={`${btn} border-slate-300 text-slate-700 hover:bg-slate-50`}>
              <X className="h-4 w-4" aria-hidden="true" /> Keep original
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setDraft(shown);
                setEditing(true);
              }}
              className={`${btn} border-slate-300 text-slate-700 hover:bg-slate-50`}
            >
              <Pencil className="h-4 w-4" aria-hidden="true" /> Edit
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
