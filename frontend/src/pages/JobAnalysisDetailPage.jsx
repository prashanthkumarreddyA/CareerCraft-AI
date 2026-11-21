import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { AlertCircle, AlertTriangle, ArrowLeft, Briefcase, BriefcaseBusiness, ChevronRight, Loader2, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import ConfirmDialog from '../components/ConfirmDialog';
import MatchScoreCard from '../components/job-analysis/MatchScoreCard';
import KeywordGroups from '../components/job-analysis/KeywordGroups';
import RequirementGroups, { ExplanationBody } from '../components/job-analysis/RequirementGroups';
import { CLASS_META, GROUP_TITLES } from '../components/job-analysis/classification';
import { deleteJobAnalysis, fetchJobAnalysis } from '../services/jobAnalysis.service';
import { formatDateTime } from '../utils/format';
import TailoringSection from '../components/tailoring/TailoringSection';

function ResponsibilityList({ responsibilities }) {
  return (
    <section className="space-y-2" aria-labelledby="resp-heading">
      <h2 id="resp-heading" className="font-semibold text-slate-900">
        Responsibilities
      </h2>
      {responsibilities.length ? (
        <ul className="space-y-1.5">
          {responsibilities.map((r) => {
            const meta = CLASS_META[r.classification];
            return (
              <li key={r.id}>
                <details className="group rounded-lg border border-slate-200 bg-white open:shadow-sm">
                  <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-2.5 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-90" aria-hidden="true" />
                    <span className="min-w-0 flex-1 text-sm text-slate-800">{r.text}</span>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${meta.chip}`}>{meta.label}</span>
                  </summary>
                  <ExplanationBody item={r} />
                </details>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-slate-400">No responsibilities were identified.</p>
      )}
    </section>
  );
}

function ExperienceCheck({ experience }) {
  if (!experience.required) {
    return <p className="text-sm text-slate-600">{experience.explanation}</p>;
  }
  const meta = CLASS_META[experience.classification];
  return (
    <div className="space-y-1">
      <p className="text-sm">
        <span className={`mr-2 rounded-full border px-2 py-0.5 text-xs font-medium ${meta.chip}`}>{meta.label}</span>
        {experience.explanation}
      </p>
      {experience.quote && <p className="text-xs text-slate-500">Job description: “{experience.quote}”</p>}
    </div>
  );
}

function JobOverview({ analysis }) {
  const { jobAnalysis } = analysis;
  const groups = Object.entries(jobAnalysis.categories);
  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="overview-heading">
      <h2 id="overview-heading" className="font-semibold text-slate-900">
        What the job asks for
      </h2>
      <p className="text-sm text-slate-700">{jobAnalysis.roleSummary}</p>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Seniority</dt>
          <dd className="capitalize text-slate-800">{jobAnalysis.seniority}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Experience</dt>
          <dd>
            <ExperienceCheck experience={analysis.matchAnalysis.experience} />
          </dd>
        </div>
        {jobAnalysis.education && (
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Education</dt>
            <dd className="text-slate-800">{jobAnalysis.education}</dd>
          </div>
        )}
        {groups.map(([group, keywords]) => (
          <div key={group}>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{GROUP_TITLES[group] ?? group}</dt>
            <dd className="text-slate-800">{keywords.join(', ')}</dd>
          </div>
        ))}
        {jobAnalysis.softSkills.length > 0 && (
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Soft skills (not scored)</dt>
            <dd className="text-slate-800">{jobAnalysis.softSkills.join(', ')}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

export default function JobAnalysisDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ status: 'loading', analysis: null, error: null });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let active = true;
    setState({ status: 'loading', analysis: null, error: null });
    fetchJobAnalysis(id)
      .then((analysis) => active && setState({ status: 'ready', analysis, error: null }))
      .catch((error) => active && setState({ status: 'error', analysis: null, error }));
    return () => {
      active = false;
    };
  }, [id]);

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteJobAnalysis(id);
      toast.success('Analysis deleted.');
      navigate('/job-analysis', { replace: true });
    } catch (err) {
      toast.error(err.message);
      setDeleting(false);
    }
  }

  const back = (
    <Link to="/job-analysis" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-800 hover:underline">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All analyses
    </Link>
  );

  if (state.status === 'loading') {
    return (
      <div className="space-y-4">
        {back}
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading analysis…
        </p>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="space-y-4">
        {back}
        <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{state.error.status === 404 ? 'This analysis does not exist or has been deleted.' : state.error.message}</p>
        </div>
      </div>
    );
  }

  const { analysis } = state;
  const { matchAnalysis } = analysis;
  return (
    <div className="space-y-6">
      {back}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-800">
            <Briefcase className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{analysis.jobTitle}</h1>
            <p className="text-sm text-slate-600">
              {analysis.companyName} · analysed {formatDateTime(analysis.createdAt)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/applications/new?analysis=${analysis.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-800 hover:bg-brand-100">
            <BriefcaseBusiness className="h-4 w-4" aria-hidden="true" /> Track this job
          </Link>
          <button type="button" onClick={() => setConfirmDelete(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50">
            <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete
          </button>
        </div>
      </div>

      {analysis.stale && (
        <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            <span className="font-semibold">Outdated analysis.</span> Your master resume was replaced after this analysis, so its matches may no longer be accurate and it cannot be used for new tailored versions. Run a new analysis of this job description.
          </p>
        </div>
      )}

      <MatchScoreCard score={matchAnalysis.score} />

      <TailoringSection analysisId={analysis.id} stale={analysis.stale} />

      {matchAnalysis.warnings.length > 0 && (
        <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <ul className="space-y-0.5">
            {matchAnalysis.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <KeywordGroups keywordAnalysis={analysis.keywordAnalysis} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          <RequirementGroups requirements={matchAnalysis.requirements} />
          <ResponsibilityList responsibilities={matchAnalysis.responsibilities} />
        </div>
        <div className="space-y-6">
          <JobOverview analysis={analysis} />
          <details className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-slate-800 hover:bg-slate-50">Job description as analysed</summary>
            <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap border-t border-slate-200 px-5 py-3 font-sans text-sm text-slate-700">{analysis.jobDescription}</pre>
          </details>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this analysis?"
        message={`The saved analysis for “${analysis.jobTitle}” at ${analysis.companyName} will be permanently deleted.`}
        confirmLabel="Delete"
        danger
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
