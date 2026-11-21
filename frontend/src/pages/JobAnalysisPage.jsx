import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { AlertCircle, ArrowRight, Loader2, ScanSearch, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import FormField from '../components/FormField';
import ConfirmDialog from '../components/ConfirmDialog';
import { useMasterResume } from '../hooks/useMasterResume';
import { createJobAnalysis, deleteJobAnalysis, listJobAnalyses } from '../services/jobAnalysis.service';
import { scoreTone } from '../components/job-analysis/classification';
import { formatDateTime } from '../utils/format';

// Mirrors the backend validation (validators/job-analysis.schema.js).
const LIMITS = { companyName: 120, jobTitle: 150, jdMin: 80, jdMax: 20_000 };

function validate({ companyName, jobTitle, jobDescription }) {
  const errors = {};
  if (!companyName.trim()) errors.companyName = 'Company name is required.';
  else if (companyName.trim().length > LIMITS.companyName) errors.companyName = `At most ${LIMITS.companyName} characters.`;
  if (!jobTitle.trim()) errors.jobTitle = 'Job title is required.';
  else if (jobTitle.trim().length > LIMITS.jobTitle) errors.jobTitle = `At most ${LIMITS.jobTitle} characters.`;
  const jd = jobDescription.trim();
  if (jd.length < LIMITS.jdMin) errors.jobDescription = `Paste the full job description (at least ${LIMITS.jdMin} characters).`;
  else if (jd.length > LIMITS.jdMax) errors.jobDescription = `The job description must be at most ${LIMITS.jdMax.toLocaleString()} characters.`;
  return errors;
}

function useElapsedSeconds(running) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) return undefined;
    setSeconds(0);
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return seconds;
}

function AnalysisForm({ disabled, onCreated }) {
  const [values, setValues] = useState({ companyName: '', jobTitle: '', jobDescription: '' });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState(null);
  const elapsed = useElapsedSeconds(submitting);
  const set = (field) => (e) => setValues((v) => ({ ...v, [field]: e.target.value }));
  const jdLength = values.jobDescription.trim().length;

  async function handleSubmit(e) {
    e.preventDefault();
    const found = validate(values);
    setErrors(found);
    setServerError(null);
    if (Object.keys(found).length) return;
    setSubmitting(true);
    try {
      const analysis = await createJobAnalysis(values);
      toast.success('Analysis saved.');
      onCreated(analysis);
    } catch (err) {
      setServerError(err);
      if (err.code === 'VALIDATION_ERROR' && err.details?.length) {
        setErrors(Object.fromEntries(err.details.filter((d) => d.path).map((d) => [d.path, d.message])));
      } else toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="companyName" label="Company name" value={values.companyName} onChange={set('companyName')} error={errors.companyName} maxLength={LIMITS.companyName} disabled={submitting || disabled} autoComplete="organization" />
        <FormField id="jobTitle" label="Job title" value={values.jobTitle} onChange={set('jobTitle')} error={errors.jobTitle} maxLength={LIMITS.jobTitle} disabled={submitting || disabled} autoComplete="organization-title" />
      </div>
      <div>
        <div className="flex items-end justify-between">
          <label htmlFor="jobDescription" className="block text-sm font-medium text-slate-700">
            Job description
          </label>
          <span className={`text-xs ${jdLength > LIMITS.jdMax ? 'text-red-600' : 'text-slate-500'}`}>
            {jdLength.toLocaleString()} / {LIMITS.jdMax.toLocaleString()}
          </span>
        </div>
        <textarea
          id="jobDescription"
          rows={14}
          value={values.jobDescription}
          onChange={set('jobDescription')}
          disabled={submitting || disabled}
          placeholder="Paste the complete job description: responsibilities, requirements, nice-to-haves…"
          aria-invalid={Boolean(errors.jobDescription)}
          aria-describedby={errors.jobDescription ? 'jobDescription-error' : undefined}
          className={`mt-1 block w-full resize-y rounded-lg border px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 ${
            errors.jobDescription ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:border-brand-600 focus:ring-brand-100'
          }`}
        />
        {errors.jobDescription && (
          <p id="jobDescription-error" className="mt-1 text-xs text-red-600">
            {errors.jobDescription}
          </p>
        )}
      </div>

      {serverError && serverError.code !== 'VALIDATION_ERROR' && (
        <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            {serverError.message}
            {serverError.details?.retryAfterSeconds ? ` Try again in about ${Math.ceil(serverError.details.retryAfterSeconds / 60)} minute(s).` : ''}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={submitting || disabled}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-900 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ScanSearch className="h-4 w-4" aria-hidden="true" />}
          {submitting ? 'Analysing…' : 'Analyse job description'}
        </button>
        {submitting && (
          <p className="text-sm text-slate-600" aria-live="polite">
            Extracting requirements and comparing them with your resume ({elapsed}s). This usually takes under a minute, but can take up to three when the AI service is busy.
          </p>
        )}
      </div>
      <p className="text-xs text-slate-500">
        Only the job description and the professional content of your master resume (skills, role titles, dates, bullet points) are sent to the AI. Your name and contact details, company names and the PDF are not.
      </p>
    </form>
  );
}

function AnalysisHistory({ state, onDelete }) {
  if (state.status === 'loading') return <p className="text-sm text-slate-500">Loading saved analyses…</p>;
  if (state.status === 'error') return <p className="text-sm text-red-700">{state.error?.message}</p>;
  if (!state.items.length) return <p className="text-sm text-slate-500">No saved analyses yet. Your analyses appear here after you run them.</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {state.items.map((item) => {
        const tone = scoreTone(item.matchPercentage);
        return (
          <li key={item.id} className="flex items-center gap-3 py-3">
            <span className={`w-12 shrink-0 text-right text-lg font-semibold ${tone.text}`}>{item.matchPercentage}%</span>
            <Link to={`/job-analysis/${item.id}`} className="min-w-0 flex-1 rounded-md px-1 hover:bg-slate-50">
              <p className="truncate font-medium text-slate-900">{item.jobTitle}</p>
              <p className="truncate text-xs text-slate-500">
                {item.companyName} · {formatDateTime(item.createdAt)} · {item.matchedRequirements}/{item.totalRequirements} matched
                {item.stale && <span className="ml-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">Outdated</span>}
              </p>
            </Link>
            <button type="button" onClick={() => onDelete(item)} className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Delete analysis for ${item.jobTitle} at ${item.companyName}`}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export default function JobAnalysisPage() {
  const navigate = useNavigate();
  const master = useMasterResume();
  const [history, setHistory] = useState({ status: 'loading', items: [], total: 0, error: null });
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const data = await listJobAnalyses({ limit: 50 });
      setHistory({ status: 'ready', items: data.items, total: data.total, error: null });
    } catch (error) {
      setHistory({ status: 'error', items: [], total: 0, error });
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  async function confirmDelete() {
    setDeleting(true);
    try {
      await deleteJobAnalysis(pendingDelete.id);
      toast.success('Analysis deleted.');
      setPendingDelete(null);
      loadHistory();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeleting(false);
    }
  }

  const noResume = master.status === 'ready' && !master.resume;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Job description analysis</h1>
        <p className="mt-1 text-sm text-slate-600">Paste a job description to see which requirements your master resume already covers. Nothing in your resume is changed.</p>
      </div>

      {noResume && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p>Upload your master resume first: the analysis compares the job description against it.</p>
          <Link to="/master-resume" className="inline-flex items-center gap-1.5 rounded-lg bg-brand-800 px-3 py-1.5 font-medium text-white hover:bg-brand-900">
            Upload resume <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <AnalysisForm disabled={noResume || master.status !== 'ready'} onCreated={(a) => navigate(`/job-analysis/${a.id}`)} />
        <section className="h-fit rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="history-heading">
          <h2 id="history-heading" className="font-semibold text-slate-900">
            Saved analyses {history.total > 0 && <span className="font-normal text-slate-500">({history.total})</span>}
          </h2>
          <div className="mt-2">
            <AnalysisHistory state={history} onDelete={setPendingDelete} />
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete this analysis?"
        message={pendingDelete ? `The saved analysis for “${pendingDelete.jobTitle}” at ${pendingDelete.companyName} will be permanently deleted.` : ''}
        confirmLabel="Delete"
        danger
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
