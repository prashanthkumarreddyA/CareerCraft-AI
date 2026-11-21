import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { AlertCircle, AlertTriangle, ArrowLeft, CheckCheck, Copy, Loader2, Lock, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import ConfirmDialog from '../components/ConfirmDialog';
import ChangeCard from '../components/tailoring/ChangeCard';
import OrderChangeCard from '../components/tailoring/OrderChangeCard';
import PdfPanel from '../components/tailoring/PdfPanel';
import { BlockedPanel, CoveragePanel, GapsPanel, LayoutPanel } from '../components/tailoring/ReviewPanels';
import { IssueList } from '../components/tailoring/ChangeCard';
import {
  acceptAllChanges,
  approveTailoredResume,
  decideChange,
  deleteTailoredResume,
  duplicateTailoredResume,
  fetchTailoredResume,
} from '../services/tailoredResume.service';
import { formatDateTime } from '../utils/format';

const STATUS = {
  draft: ['Draft: review the changes', 'bg-amber-50 text-amber-800 border-amber-200'],
  approved: ['Approved: content frozen', 'bg-sky-50 text-sky-800 border-sky-200'],
  pdf_ready: ['PDF ready', 'bg-emerald-50 text-emerald-800 border-emerald-200'],
};

export default function TailoredResumePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ status: 'loading', resume: null, error: null });
  const [approving, setApproving] = useState(false);
  const [approvalProblems, setApprovalProblems] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      setState({ status: 'ready', resume: await fetchTailoredResume(id), error: null });
    } catch (error) {
      setState({ status: 'error', resume: null, error });
    }
  }, [id]);

  useEffect(() => {
    setState({ status: 'loading', resume: null, error: null });
    load();
  }, [load]);

  const resume = state.resume;
  const setResume = (r) => setState({ status: 'ready', resume: r, error: null });

  /** Sends a decision with the latest revision; returns { ok } or { claimIssues } for unsupported edits. */
  async function onDecide(changeId, body) {
    try {
      setResume(await decideChange(resume.id, changeId, { ...body, expectedRevision: resume.revision }));
      setApprovalProblems(null);
      return { ok: true };
    } catch (err) {
      if (err.code === 'CLAIM_CHECK_FAILED' || (err.code === 'REVIEW_REQUIRED' && body.decision === 'edit')) return { claimIssues: err.details?.issues ?? [] };
      if (err.code === 'REVIEW_REQUIRED') {
        toast.error('This suggestion may change the meaning of the original. Tick the review box on the card first.');
        await load();
        return { ok: false };
      }
      if (err.code === 'REVISION_CONFLICT' || err.code === 'VERSION_LOCKED') {
        toast.error(err.message);
        await load();
        return { ok: false };
      }
      toast.error(err.details?.issues?.[0]?.message ?? err.message);
      return { ok: false };
    }
  }

  async function acceptAll() {
    try {
      const updated = await acceptAllChanges(resume.id, resume.revision);
      setResume(updated);
      const waiting = updated.changes.filter((c) => c.decision === 'pending').length;
      toast.success(waiting ? `Suggestions accepted. ${waiting} still need${waiting === 1 ? 's' : ''} your review.` : 'All suggestions accepted. Review the result before approving.');
    } catch (err) {
      toast.error(err.message);
      if (err.code === 'REVISION_CONFLICT') load();
    }
  }

  async function approve() {
    setApproving(true);
    setApprovalProblems(null);
    try {
      setResume(await approveTailoredResume(resume.id, resume.revision));
      toast.success('Content approved. You can now generate the PDF.');
    } catch (err) {
      setApprovalProblems(err.details?.problems ?? [{ message: err.message }]);
      toast.error(err.message);
      if (err.code === 'REVISION_CONFLICT') load();
    } finally {
      setApproving(false);
    }
  }

  async function duplicate() {
    try {
      const copy = await duplicateTailoredResume(resume.id);
      toast.success(`Version ${copy.versionNumber} created as an editable draft.`);
      navigate(`/tailored-resumes/${copy.id}`);
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      await deleteTailoredResume(resume.id);
      toast.success('Version deleted.');
      navigate(`/job-analysis/${resume.jobAnalysisId}`, { replace: true });
    } catch (err) {
      toast.error(err.message);
      setDeleting(false);
    }
  }

  if (state.status === 'loading') {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading tailored resume…
      </p>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>{state.error.status === 404 ? 'This tailored resume does not exist or has been deleted.' : state.error.message}</p>
      </div>
    );
  }

  const readOnly = resume.status !== 'draft';
  const [statusLabel, statusClass] = STATUS[resume.status];
  const byId = Object.fromEntries(resume.changes.map((c) => [c.changeId, c]));
  const base = resume.baseContent;
  const { progress } = resume;

  return (
    <div className="space-y-6">
      <Link to={`/job-analysis/${resume.jobAnalysisId}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-800 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to the job analysis
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Tailored resume · version {resume.versionNumber}
          </h1>
          <p className="text-sm text-slate-600">
            {resume.jobTitle} at {resume.companyName} · created {formatDateTime(resume.createdAt)}
            {resume.copiedFrom && ` · copied from version ${resume.copiedFrom.versionNumber}`}
          </p>
          <span className={`mt-2 inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusClass}`}>
            {readOnly && <Lock className="h-3 w-3" aria-hidden="true" />}
            {statusLabel}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {readOnly && (
            <button type="button" onClick={duplicate} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <Copy className="h-4 w-4" aria-hidden="true" /> Duplicate to edit
            </button>
          )}
          <button type="button" onClick={() => setConfirmDelete(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50">
            <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete
          </button>
        </div>
      </div>

      {resume.masterChanged && (
        <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>Your master resume has changed since this version was created. It is kept for reference but can no longer be approved, turned into a PDF or copied (any PDF already generated stays downloadable). Run a new analysis to tailor your current resume.</p>
        </div>
      )}

      {!readOnly && (
        <section className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/95 p-4 shadow-sm backdrop-blur">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-slate-900">
              {progress.total - progress.pending} of {progress.total} changes decided
              {progress.overrides > 0 && <span className="text-red-700"> · {progress.overrides} override(s)</span>}
            </p>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
              <div className="h-full bg-brand-700 transition-all" style={{ width: `${progress.total ? ((progress.total - progress.pending) / progress.total) * 100 : 100}%` }} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {progress.pending > 0 && (
              <button
                type="button"
                onClick={acceptAll}
                title="Suggestions that may change the meaning of the original are skipped: review them on their cards."
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-600 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
              >
                <CheckCheck className="h-4 w-4" aria-hidden="true" /> Accept all suggestions (except those needing review)
              </button>
            )}
            <button
              type="button"
              onClick={approve}
              disabled={approving || progress.pending > 0 || !resume.layout.passed}
              title={progress.pending > 0 ? 'Decide every change first' : undefined}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {approving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Approve content
            </button>
          </div>
          {approvalProblems && (
            <div className="w-full">
              <IssueList tone="red" issues={approvalProblems} />
            </div>
          )}
        </section>
      )}

      {readOnly && <PdfPanel resume={resume} onUpdated={setResume} />}

      <div className="grid gap-6 lg:grid-cols-3">
        <CoveragePanel coverage={resume.coverage} />
        <GapsPanel gaps={resume.gaps} />
        <LayoutPanel layout={resume.layout} />
      </div>

      {resume.changes.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">No changes were proposed: your master resume already fits this job as well as its facts allow.</p>}

      {byId.summary && (
        <section className="space-y-3">
          <h2 className="font-semibold text-slate-900">Professional summary</h2>
          <ChangeCard change={byId.summary} title="Summary" readOnly={readOnly} onDecide={onDecide} />
        </section>
      )}

      {byId['skills-order'] && (
        <section className="space-y-3">
          <h2 className="font-semibold text-slate-900">Technical skills</h2>
          <OrderChangeCard change={byId['skills-order']} title="Skills order" readOnly={readOnly} onDecide={onDecide} />
        </section>
      )}

      {base.experience.map((role, r) => {
        const order = byId[`order-${r + 1}`];
        const bulletChanges = resume.changes.filter((c) => c.type === 'bullet' && c.target.roleIndex === r);
        if (!order && !bulletChanges.length) return null;
        return (
          <section key={r} className="space-y-3">
            <h2 className="font-semibold text-slate-900">
              {role.title} <span className="font-normal text-slate-500">· {role.company} · {[role.startDate, role.endDate].filter(Boolean).join(' – ')}</span>
            </h2>
            {order && <OrderChangeCard change={order} title="Bullet order" bullets={role.bullets} readOnly={readOnly} onDecide={onDecide} />}
            {bulletChanges.map((c) => (
              <ChangeCard key={c.changeId} change={c} title={`Bullet ${c.target.bulletIndex + 1}`} readOnly={readOnly} onDecide={onDecide} />
            ))}
          </section>
        );
      })}

      <BlockedPanel blocked={resume.blocked} />

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete version ${resume.versionNumber}?`}
        message="The tailored content, its decisions and any generated PDF are permanently deleted. Your master resume is not affected."
        confirmLabel="Delete"
        danger
        busy={deleting}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
