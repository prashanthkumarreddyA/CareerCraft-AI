import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { AlertCircle, ArrowLeft, ExternalLink, Loader2, Pencil, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import ConfirmDialog from '../components/ConfirmDialog';
import * as svc from '../services/jobApplication.service';
import { EMPLOYMENT_TYPES, formatDate, formatExperience, formatSalary, SOURCES, StatusChip } from '../components/applications/meta';
import { FollowUpsPanel, InterviewsPanel, ResumePanel, StatusPanel } from '../components/applications/DetailPanels';

function Row({ label, children }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words text-slate-800">{children || '—'}</dd>
    </div>
  );
}

export default function ApplicationDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ status: 'loading', app: null, error: null });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    svc
      .fetchApplication(id)
      .then((app) => setState({ status: 'ready', app, error: null }))
      .catch((error) => setState({ status: 'error', app: null, error }));
  }, [id]);
  useEffect(load, [load]);

  const app = state.app;
  // Latest application (with its current revision) and a queue, so quick successive actions run
  // one after another, each with the revision returned by the previous one.
  const appRef = useRef(null);
  appRef.current = state.app;
  const queue = useRef(Promise.resolve());

  /**
   * Runs one change with the latest revision (changes are queued). Returns true on success. A
   * revision conflict (changed in another tab) reloads the latest version instead of overwriting it.
   */
  function run(action) {
    const next = queue.current.then(() => perform(action));
    queue.current = next.catch(() => {});
    return next;
  }

  async function perform(action) {
    const a = appRef.current;
    if (!a) return false;
    const actions = {
      changeStatus: (status, note) => svc.changeStatus(a.id, status, a.revision, note),
      undoStatus: () => svc.undoStatus(a.id, a.revision),
      setLinks: (links) => svc.setLinks(a.id, links, a.revision),
      addInterview: (body) => svc.addInterview(a.id, { ...body, expectedRevision: a.revision }),
      updateInterview: (iid, body) => svc.updateInterview(a.id, iid, { ...body, expectedRevision: a.revision }),
      rescheduleInterview: (iid, body) => svc.rescheduleInterview(a.id, iid, { ...body, expectedRevision: a.revision }),
      cancelInterview: (iid, body) => svc.cancelInterview(a.id, iid, { ...body, expectedRevision: a.revision }),
      addFollowUp: (body) => svc.addFollowUp(a.id, { ...body, expectedRevision: a.revision }),
      updateFollowUp: (fid, body) => svc.updateFollowUp(a.id, fid, { ...body, expectedRevision: a.revision }),
      deleteFollowUp: (fid) => svc.deleteFollowUp(a.id, fid, a.revision),
    };
    try {
      const updated = await action(actions);
      appRef.current = updated;
      setState({ status: 'ready', app: updated, error: null });
      return true;
    } catch (err) {
      const detail = err.details?.[0]?.message;
      toast.error(detail && err.code === 'VALIDATION_ERROR' ? detail : err.message);
      if (err.code === 'REVISION_CONFLICT') load();
      return false;
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      await svc.deleteApplication(app.id);
      toast.success('Application deleted. Linked analyses and resumes were kept.');
      navigate('/applications', { replace: true });
    } catch (err) {
      toast.error(err.message);
      setDeleting(false);
    }
  }

  if (state.status === 'loading') {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-600">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading application…
      </p>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="space-y-4">
        <Link to="/applications" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Applications
        </Link>
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{state.error.status === 404 ? 'This application does not exist or belongs to another account.' : state.error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link to="/applications" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Applications
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-slate-900">{app.jobTitle}</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            {app.companyName}
            {app.location && <span>· {app.location}</span>}
            <StatusChip status={app.status} />
          </p>
        </div>
        <div className="flex gap-2">
          <Link to={`/applications/${app.id}/edit`} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <Pencil className="h-4 w-4" aria-hidden="true" /> Edit
          </Link>
          <button type="button" onClick={() => setConfirmDelete(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50">
            <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="details-heading">
            <h2 id="details-heading" className="mb-2 font-semibold text-slate-900">
              Details
            </h2>
            <dl className="divide-y divide-slate-100">
              <Row label="Application date">{app.applicationDate && formatDate(app.applicationDate)}</Row>
              <Row label="Employment type">{EMPLOYMENT_TYPES[app.employmentType]}</Row>
              <Row label="Salary">{formatSalary(app.salary)}</Row>
              <Row label="Experience">{formatExperience(app.experience)}</Row>
              <Row label="Source">{[SOURCES[app.source], app.sourceDetail].filter(Boolean).join(' · ')}</Row>
              <Row label="Job URL">
                {app.jobUrl && (
                  <a href={app.jobUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-800 hover:underline">
                    <span className="break-all">{app.jobUrl}</span> <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                  </a>
                )}
              </Row>
              <Row label="Notes">{app.notes && <span className="whitespace-pre-line">{app.notes}</span>}</Row>
            </dl>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium text-brand-800">Saved job description{app.jobDescription ? '' : ' (none)'}</summary>
              {app.jobDescription && <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-sm text-slate-700">{app.jobDescription}</pre>}
            </details>
          </section>
          <InterviewsPanel app={app} run={run} />
          <FollowUpsPanel app={app} run={run} />
        </div>
        <div className="space-y-6">
          <StatusPanel app={app} run={run} />
          <ResumePanel app={app} run={run} />
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this application?"
        message="This deletes the application with its interviews, follow-ups and history. Your master resume, job analyses and tailored resumes are kept."
        confirmLabel="Delete"
        danger
        busy={deleting}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
