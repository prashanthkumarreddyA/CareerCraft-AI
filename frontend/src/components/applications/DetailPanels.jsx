import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, CalendarClock, CheckCircle2, Download, ExternalLink, FileText, History, Plus, Trash2, Undo2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import PdfPreview from '../PdfPreview';
import { listJobAnalyses } from '../../services/jobAnalysis.service';
import { fetchTailoredPdf, fetchTailoredPdfDownloadUrl, listTailoredResumes } from '../../services/tailoredResume.service';
import { formatDateTime } from '../../utils/format';
import { formatDate, fromLocalInput, RESULTS, ROUND_TYPES, STATUS_META, StatusChip, todayLocal, toLocalInput } from './meta';

const card = 'rounded-xl border border-slate-200 bg-white p-5 shadow-sm';
const input = 'mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100';
const btn = 'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50';
const primary = `${btn} border-brand-800 bg-brand-800 text-white hover:bg-brand-900`;
const secondary = `${btn} border-slate-300 text-slate-700 hover:bg-slate-50`;

/* ------------------------------------------------------------------ status */

export function StatusPanel({ app, run }) {
  const [note, setNote] = useState('');
  return (
    <section className={card} aria-labelledby="status-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="status-heading" className="font-semibold text-slate-900">
          Status
        </h2>
        <StatusChip status={app.status} />
      </div>
      {app.allowedStatuses.length > 0 ? (
        <div className="mt-3 space-y-2">
          <label className="block text-xs font-medium text-slate-600" htmlFor="status-note">
            Note for the next change (optional)
          </label>
          <input id="status-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={input} placeholder="e.g. Applied through the careers page" />
          <div className="flex flex-wrap gap-2">
            {app.allowedStatuses.map((s) => (
              <button key={s} type="button" className={secondary} onClick={async () => (await run((a) => a.changeStatus(s, note.trim()))) && setNote('')}>
                <span className={`h-2 w-2 rounded-full ${STATUS_META[s].dot}`} aria-hidden="true" /> Move to {STATUS_META[s].label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-600">{STATUS_META[app.status].label} is a final status.</p>
      )}
      {app.canUndo && (
        <button type="button" className={`${secondary} mt-3`} onClick={() => run((a) => a.undoStatus())}>
          <Undo2 className="h-4 w-4" aria-hidden="true" /> Undo last change
        </button>
      )}
      <h3 className="mt-5 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
        <History className="h-4 w-4" aria-hidden="true" /> History
      </h3>
      <ol className="mt-2 space-y-2 border-l border-slate-200 pl-4 text-sm">
        {[...app.statusHistory].reverse().map((e, i) => (
          <li key={i} className="relative">
            <span className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ${STATUS_META[e.to].dot}`} aria-hidden="true" />
            <span className="font-medium text-slate-800">{e.kind === 'created' ? `Added as ${STATUS_META[e.to].label}` : e.kind === 'undo' ? `Undo: back to ${STATUS_META[e.to].label}` : `${STATUS_META[e.from].label} → ${STATUS_META[e.to].label}`}</span>
            <span className="block text-xs text-slate-500">{formatDateTime(e.at)}</span>
            {e.note && <span className="block text-xs text-slate-600">“{e.note}”</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------------ resume links */

function LinkEditor({ app, run, onClose }) {
  const [analyses, setAnalyses] = useState(null);
  const [analysisId, setAnalysisId] = useState(app.jobAnalysisId ?? '');
  const [versions, setVersions] = useState([]);
  const [versionId, setVersionId] = useState(app.tailoredResumeId ?? '');

  useEffect(() => {
    listJobAnalyses({ page: 1, limit: 50 })
      .then((d) => setAnalyses(d.items))
      .catch((err) => toast.error(err.message));
  }, []);
  useEffect(() => {
    if (!analysisId) return setVersions([]);
    listTailoredResumes(analysisId)
      .then((items) => setVersions(items.filter((v) => v.status === 'approved' || v.status === 'pdf_ready')))
      .catch(() => setVersions([]));
    return undefined;
  }, [analysisId]);

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Job analysis</span>
        <select
          value={analysisId}
          onChange={(e) => {
            setAnalysisId(e.target.value);
            setVersionId('');
          }}
          className={input}
          disabled={!analyses}
        >
          <option value="">None</option>
          {analyses?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.jobTitle} · {a.companyName} ({a.matchPercentage}%){a.stale ? ' · outdated' : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Tailored resume (approved versions only)</span>
        <select value={versionId} onChange={(e) => setVersionId(e.target.value)} className={input} disabled={!analysisId}>
          <option value="">None</option>
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              Version {v.versionNumber} · {v.status === 'pdf_ready' ? 'PDF ready' : 'approved'}
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-2">
        <button type="button" className={primary} onClick={async () => (await run((a) => a.setLinks({ jobAnalysisId: analysisId || null, tailoredResumeId: versionId || null }))) && onClose()}>
          Save links
        </button>
        <button type="button" className={secondary} onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function ResumePanel({ app, run }) {
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(false);
  const { jobAnalysis: analysis, tailoredResume: version } = app.links ?? {};
  async function download() {
    try {
      const { url } = await fetchTailoredPdfDownloadUrl(version.id); // signed, short-lived link from the existing endpoint
      const a = document.createElement('a');
      a.href = url;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      toast.error(err.message);
    }
  }
  return (
    <section className={card} aria-labelledby="resume-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="resume-heading" className="flex items-center gap-2 font-semibold text-slate-900">
          <FileText className="h-4 w-4 text-brand-700" aria-hidden="true" /> Resume used
        </h2>
        {!editing && (
          <button type="button" className={secondary} onClick={() => setEditing(true)}>
            {analysis || version ? 'Change' : 'Link analysis / resume'}
          </button>
        )}
      </div>
      {editing && <LinkEditor app={app} run={run} onClose={() => setEditing(false)} />}
      {!analysis && !version && !editing && <p className="mt-2 text-sm text-slate-600">No analysis or tailored resume linked.</p>}
      {analysis && (
        <div className="mt-3 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Job analysis</p>
          {analysis.missing ? (
            <p className="text-red-700">The linked analysis no longer exists.</p>
          ) : (
            <p>
              <Link to={`/job-analysis/${analysis.id}`} className="font-medium text-brand-800 hover:underline">
                {analysis.jobTitle} · {analysis.companyName}
              </Link>{' '}
              <span className="text-slate-600">· {analysis.matchPercentage}% match</span>
              {analysis.stale && <span className="ml-2 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">Outdated</span>}
            </p>
          )}
        </div>
      )}
      {version && (
        <div className="mt-3 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tailored resume</p>
          {version.missing ? (
            <p className="text-red-700">The linked version no longer exists.</p>
          ) : (
            <>
              <p>
                <Link to={`/tailored-resumes/${version.id}`} className="font-medium text-brand-800 hover:underline">
                  Version {version.versionNumber}
                </Link>{' '}
                <span className="text-slate-600">· {version.status === 'pdf_ready' ? 'PDF ready' : 'approved, no PDF yet'}</span>
                {version.masterChanged && <span className="ml-2 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">Outdated</span>}
              </p>
              {version.hasPdf && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className={secondary} onClick={() => setPreview((p) => !p)}>
                    <FileText className="h-4 w-4" aria-hidden="true" /> {preview ? 'Hide PDF' : 'View PDF'}
                  </button>
                  <button type="button" className={secondary} onClick={download}>
                    <Download className="h-4 w-4" aria-hidden="true" /> Download PDF
                  </button>
                </div>
              )}
              {preview && version.hasPdf && (
                <div className="mt-3">
                  <PdfPreview version={`${version.id}`} fetchPdf={(opts) => fetchTailoredPdf(version.id, opts)} title={`Tailored resume version ${version.versionNumber}`} />
                </div>
              )}
            </>
          )}
        </div>
      )}
      {app.linkHistory.length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-medium text-slate-700">Previously linked ({app.linkHistory.length})</summary>
          <ul className="mt-2 space-y-1 text-xs text-slate-600">
            {[...app.linkHistory].reverse().map((l, i) => (
              <li key={i}>
                {l.tailoredResumeId ? (
                  <Link to={`/tailored-resumes/${l.tailoredResumeId}`} className="text-brand-800 hover:underline">
                    Version {l.versionNumber ?? '?'}
                  </Link>
                ) : l.jobAnalysisId ? (
                  <Link to={`/job-analysis/${l.jobAnalysisId}`} className="text-brand-800 hover:underline">
                    Analysis only
                  </Link>
                ) : (
                  'Nothing'
                )}{' '}
                · linked {formatDateTime(l.linkedAt)} · replaced {formatDateTime(l.unlinkedAt)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ interviews */

const emptyInterview = { roundType: 'technical', scheduledAt: '', durationMinutes: '', interviewer: '', meetingLink: '', notes: '' };

function InterviewForm({ onSubmit, onCancel }) {
  const [f, setF] = useState(emptyInterview);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form
      className="mt-3 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const scheduledAt = fromLocalInput(f.scheduledAt);
        if (!scheduledAt) return toast.error('Choose the interview date and time.');
        const ok = await onSubmit({
          roundType: f.roundType,
          scheduledAt,
          durationMinutes: f.durationMinutes ? Number(f.durationMinutes) : null,
          interviewer: f.interviewer,
          meetingLink: f.meetingLink.trim(),
          notes: f.notes,
        });
        if (ok) setF(emptyInterview);
        return undefined;
      }}
    >
      <label className="text-sm">
        <span className="font-medium text-slate-700">Round type</span>
        <select value={f.roundType} onChange={set('roundType')} className={input}>
          {Object.entries(ROUND_TYPES).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="font-medium text-slate-700">Date and time (your time zone)</span>
        <input type="datetime-local" value={f.scheduledAt} onChange={set('scheduledAt')} className={input} required />
      </label>
      <label className="text-sm">
        <span className="font-medium text-slate-700">Duration (minutes)</span>
        <input type="number" min="5" max="600" value={f.durationMinutes} onChange={set('durationMinutes')} className={input} />
      </label>
      <label className="text-sm">
        <span className="font-medium text-slate-700">Interviewer</span>
        <input value={f.interviewer} onChange={set('interviewer')} maxLength={200} className={input} />
      </label>
      <label className="text-sm sm:col-span-2">
        <span className="font-medium text-slate-700">Meeting link</span>
        <input type="url" value={f.meetingLink} onChange={set('meetingLink')} placeholder="https://" maxLength={2048} className={input} />
      </label>
      <label className="text-sm sm:col-span-2">
        <span className="font-medium text-slate-700">Notes</span>
        <textarea rows={2} value={f.notes} onChange={set('notes')} maxLength={5000} className={input} />
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" className={primary}>
          Add round
        </button>
        <button type="button" className={secondary} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function InterviewItem({ iv, run }) {
  const [mode, setMode] = useState(null); // 'edit' | 'reschedule' | 'cancel'
  const [edit, setEdit] = useState({ result: iv.result, feedback: iv.feedback, notes: iv.notes, interviewer: iv.interviewer, meetingLink: iv.meetingLink });
  const [when, setWhen] = useState(toLocalInput(iv.scheduledAt));
  const [reason, setReason] = useState('');
  const cancelled = iv.status === 'cancelled';
  const done = async (p) => (await p) && setMode(null);
  return (
    <li className={`rounded-lg border p-3 ${cancelled ? 'border-slate-200 bg-slate-50' : 'border-slate-200'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium text-slate-900">
            Round {iv.round}: {ROUND_TYPES[iv.roundType]}
            <span className={`ml-2 rounded-full border px-2 py-0.5 text-xs font-medium ${cancelled ? 'border-slate-200 text-slate-600' : iv.status === 'completed' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-violet-200 bg-violet-50 text-violet-800'}`}>
              {cancelled ? 'Cancelled' : iv.status === 'completed' ? `Held · ${RESULTS[iv.result]}` : 'Scheduled'}
            </span>
          </p>
          <p className={`flex items-center gap-1 text-sm ${cancelled ? 'text-slate-500 line-through' : 'text-slate-700'}`}>
            <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
            {formatDateTime(iv.scheduledAt)}
            {iv.durationMinutes ? ` · ${iv.durationMinutes} min` : ''}
          </p>
          {iv.interviewer && <p className="text-xs text-slate-600">With {iv.interviewer}</p>}
          {iv.meetingLink && !cancelled && (
            <a href={iv.meetingLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-brand-800 hover:underline">
              Meeting link <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          )}
          {cancelled && <p className="text-xs text-slate-600">Cancelled {formatDateTime(iv.cancelledAt)}{iv.cancelReason ? ` · ${iv.cancelReason}` : ''}</p>}
        </div>
        <div className="flex flex-wrap gap-1">
          <button type="button" className={secondary} onClick={() => setMode(mode === 'edit' ? null : 'edit')}>
            {cancelled ? 'Notes' : 'Edit / result'}
          </button>
          {iv.status === 'scheduled' && (
            <>
              <button type="button" className={secondary} onClick={() => setMode(mode === 'reschedule' ? null : 'reschedule')}>
                Reschedule
              </button>
              <button type="button" className={`${btn} border-red-200 text-red-700 hover:bg-red-50`} onClick={() => setMode(mode === 'cancel' ? null : 'cancel')}>
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
      {iv.notes && mode !== 'edit' && <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{iv.notes}</p>}
      {iv.feedback && mode !== 'edit' && (
        <p className="mt-1 whitespace-pre-line text-sm text-slate-700">
          <span className="font-medium">Feedback: </span>
          {iv.feedback}
        </p>
      )}
      {iv.rescheduleHistory.length > 0 && (
        <details className="mt-2 text-xs text-slate-600">
          <summary className="cursor-pointer">Rescheduled {iv.rescheduleHistory.length}×</summary>
          <ul className="mt-1 space-y-0.5">
            {iv.rescheduleHistory.map((r, i) => (
              <li key={i}>
                {formatDateTime(r.from)} → {formatDateTime(r.to)}
                {r.reason ? ` · ${r.reason}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
      {mode === 'edit' && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {!cancelled && (
            <>
              <label className="text-sm">
                <span className="font-medium text-slate-700">Result</span>
                <select value={edit.result} onChange={(e) => setEdit((x) => ({ ...x, result: e.target.value }))} className={input}>
                  {Object.entries(RESULTS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="font-medium text-slate-700">Interviewer</span>
                <input value={edit.interviewer} onChange={(e) => setEdit((x) => ({ ...x, interviewer: e.target.value }))} maxLength={200} className={input} />
              </label>
              <label className="text-sm sm:col-span-2">
                <span className="font-medium text-slate-700">Meeting link</span>
                <input type="url" value={edit.meetingLink} onChange={(e) => setEdit((x) => ({ ...x, meetingLink: e.target.value }))} maxLength={2048} className={input} />
              </label>
            </>
          )}
          <label className="text-sm sm:col-span-2">
            <span className="font-medium text-slate-700">Notes</span>
            <textarea rows={2} value={edit.notes} onChange={(e) => setEdit((x) => ({ ...x, notes: e.target.value }))} maxLength={5000} className={input} />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="font-medium text-slate-700">Feedback</span>
            <textarea rows={2} value={edit.feedback} onChange={(e) => setEdit((x) => ({ ...x, feedback: e.target.value }))} maxLength={5000} className={input} />
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button
              type="button"
              className={primary}
              onClick={() => done(run((a) => a.updateInterview(iv.id, cancelled ? { notes: edit.notes, feedback: edit.feedback } : { ...edit, meetingLink: edit.meetingLink.trim() })))}
            >
              Save
            </button>
            {!cancelled && iv.status === 'scheduled' && (
              <button type="button" className={secondary} onClick={() => done(run((a) => a.updateInterview(iv.id, { completed: true, notes: edit.notes, feedback: edit.feedback })))}>
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Mark as held
              </button>
            )}
          </div>
        </div>
      )}
      {mode === 'reschedule' && (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
          <label className="text-sm">
            <span className="font-medium text-slate-700">New date and time</span>
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={input} />
          </label>
          <label className="text-sm">
            <span className="font-medium text-slate-700">Reason (optional)</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className={input} />
          </label>
          <button type="button" className={primary} onClick={() => done(run((a) => a.rescheduleInterview(iv.id, { scheduledAt: fromLocalInput(when), reason })))}>
            Reschedule
          </button>
        </div>
      )}
      {mode === 'cancel' && (
        <div className="mt-3 grid gap-2 sm:grid-cols-[2fr_auto] sm:items-end">
          <label className="text-sm">
            <span className="font-medium text-slate-700">Reason (optional)</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className={input} />
          </label>
          <button type="button" className={`${btn} border-red-600 bg-red-600 text-white hover:bg-red-700`} onClick={() => done(run((a) => a.cancelInterview(iv.id, { reason })))}>
            <X className="h-4 w-4" aria-hidden="true" /> Cancel interview
          </button>
        </div>
      )}
    </li>
  );
}

export function InterviewsPanel({ app, run }) {
  const [adding, setAdding] = useState(false);
  return (
    <section className={card} aria-labelledby="interviews-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="interviews-heading" className="font-semibold text-slate-900">
          Interviews ({app.interviews.length})
        </h2>
        {!adding && (
          <button type="button" className={secondary} onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Add round
          </button>
        )}
      </div>
      {adding && <InterviewForm onCancel={() => setAdding(false)} onSubmit={async (body) => (await run((a) => a.addInterview(body))) && (setAdding(false), true)} />}
      {app.interviews.length === 0 && !adding && <p className="mt-2 text-sm text-slate-600">No interviews yet.</p>}
      <ul className="mt-3 space-y-2">
        {app.interviews.map((iv) => (
          <InterviewItem key={iv.id} iv={iv} run={run} />
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ follow-ups */

export function FollowUpsPanel({ app, run }) {
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  return (
    <section className={card} aria-labelledby="followups-heading">
      <h2 id="followups-heading" className="font-semibold text-slate-900">
        Follow-ups
      </h2>
      <form
        className="mt-3 grid gap-2 sm:grid-cols-[auto_1fr_auto] sm:items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!date) return toast.error('Choose a follow-up date.');
          if (await run((a) => a.addFollowUp({ dueDate: date, note }))) {
            setDate('');
            setNote('');
          }
          return undefined;
        }}
      >
        <label className="text-sm">
          <span className="font-medium text-slate-700">Date</span>
          <input type="date" value={date} min={todayLocal()} onChange={(e) => setDate(e.target.value)} className={input} />
        </label>
        <label className="text-sm">
          <span className="font-medium text-slate-700">Note</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="e.g. Email the recruiter" className={input} />
        </label>
        <button type="submit" className={primary}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Add
        </button>
      </form>
      {app.followUps.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">No follow-ups.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 text-sm">
          {app.followUps.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <label className="flex min-w-0 items-start gap-2">
                <input type="checkbox" className="mt-1" checked={f.status === 'completed'} onChange={() => run((a) => a.updateFollowUp(f.id, { status: f.status === 'completed' ? 'pending' : 'completed' }))} aria-label={`Mark follow-up on ${formatDate(f.dueDate)} as ${f.status === 'completed' ? 'pending' : 'done'}`} />
                <span className={f.status === 'completed' ? 'text-slate-500 line-through' : 'text-slate-800'}>
                  <span className="font-medium">{formatDate(f.dueDate)}</span>
                  {f.note ? ` · ${f.note}` : ''}
                </span>
                {f.overdue && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                    <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Overdue
                  </span>
                )}
              </label>
              <button type="button" className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700" aria-label={`Delete follow-up on ${formatDate(f.dueDate)}`} onClick={() => run((a) => a.deleteFollowUp(f.id))}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

