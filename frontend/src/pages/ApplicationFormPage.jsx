import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, Loader2, ScanSearch } from 'lucide-react';
import toast from 'react-hot-toast';
import FormField from '../components/FormField';
import { createApplication, fetchApplication, updateApplication } from '../services/jobApplication.service';
import { fetchJobAnalysis } from '../services/jobAnalysis.service';
import { listTailoredResumes } from '../services/tailoredResume.service';
import { EMPLOYMENT_TYPES, fieldErrors, SALARY_PERIODS, SOURCES } from '../components/applications/meta';

const EMPTY = {
  companyName: '',
  jobTitle: '',
  location: '',
  employmentType: '',
  salaryMin: '',
  salaryMax: '',
  salaryCurrency: '',
  salaryPeriod: '',
  expMin: '',
  expMax: '',
  expText: '',
  source: '',
  sourceDetail: '',
  jobUrl: '',
  applicationDate: '',
  jobDescription: '',
  notes: '',
  status: 'saved',
};
const select = 'mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100';
const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

function fromApplication(a) {
  return {
    ...EMPTY,
    companyName: a.companyName,
    jobTitle: a.jobTitle,
    location: a.location ?? '',
    employmentType: a.employmentType ?? '',
    salaryMin: a.salary?.min ?? '',
    salaryMax: a.salary?.max ?? '',
    salaryCurrency: a.salary?.currency ?? '',
    salaryPeriod: a.salary?.period ?? '',
    expMin: a.experience?.minYears ?? '',
    expMax: a.experience?.maxYears ?? '',
    expText: a.experience?.text ?? '',
    source: a.source ?? '',
    sourceDetail: a.sourceDetail ?? '',
    jobUrl: a.jobUrl ?? '',
    applicationDate: a.applicationDate ?? '',
    jobDescription: a.jobDescription ?? '',
    notes: a.notes ?? '',
  };
}

function toBody(f) {
  return {
    companyName: f.companyName,
    jobTitle: f.jobTitle,
    location: f.location,
    employmentType: f.employmentType || null,
    salary: { min: num(f.salaryMin), max: num(f.salaryMax), currency: f.salaryCurrency.trim() ? f.salaryCurrency.trim().toUpperCase() : null, period: f.salaryPeriod || null },
    experience: { minYears: num(f.expMin), maxYears: num(f.expMax), text: f.expText },
    source: f.source || null,
    sourceDetail: f.sourceDetail,
    jobUrl: f.jobUrl.trim(),
    applicationDate: f.applicationDate || null,
    jobDescription: f.jobDescription,
    notes: f.notes,
  };
}

export default function ApplicationFormPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const [params] = useSearchParams();
  const analysisId = params.get('analysis');
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(editing || Boolean(analysisId));
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const [analysis, setAnalysis] = useState(null);
  const [versions, setVersions] = useState([]);
  const [versionId, setVersionId] = useState(params.get('version') ?? '');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (editing) {
          const a = await fetchApplication(id);
          if (!alive) return;
          setForm(fromApplication(a));
          setRevision(a.revision);
        } else if (analysisId) {
          const [ja, list] = await Promise.all([fetchJobAnalysis(analysisId), listTailoredResumes(analysisId).catch(() => [])]);
          if (!alive) return;
          setAnalysis(ja);
          setForm((f) => ({ ...f, companyName: ja.companyName, jobTitle: ja.jobTitle, jobDescription: ja.jobDescription }));
          const linkable = (list.items ?? list).filter((v) => v.status === 'approved' || v.status === 'pdf_ready');
          setVersions(linkable);
        }
      } catch (err) {
        toast.error(err.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [editing, id, analysisId]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      const body = toBody(form);
      const saved = editing
        ? await updateApplication(id, { ...body, expectedRevision: revision })
        : await createApplication({ ...body, status: form.status, ...(analysis ? { jobAnalysisId: analysis.id } : {}), ...(versionId ? { tailoredResumeId: versionId } : {}) });
      toast.success(editing ? 'Application updated.' : 'Application added.');
      navigate(`/applications/${saved.id}`);
    } catch (err) {
      const fe = fieldErrors(err);
      setErrors(fe);
      toast.error(Object.keys(fe).length ? 'Please correct the highlighted fields.' : err.message);
    } finally {
      setSaving(false);
    }
  }

  const e = (path) => errors[path];
  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-600">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to={editing ? `/applications/${id}` : '/applications'} className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
      </Link>
      <h1 className="text-2xl font-semibold text-slate-900">{editing ? 'Edit application' : 'New application'}</h1>

      {analysis && (
        <div className="flex items-start gap-2 rounded-xl border border-brand-100 bg-brand-50 p-4 text-sm text-brand-900">
          <ScanSearch className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="w-full">
            <p>
              Linked to your analysis of <span className="font-medium">{analysis.jobTitle}</span> at {analysis.companyName} ({analysis.matchPercentage}% match). The job description is copied into the application so it stays available.
            </p>
            <label className="mt-2 block text-xs font-medium text-brand-900" htmlFor="version">
              Tailored resume to link
            </label>
            <select id="version" value={versionId} onChange={(ev) => setVersionId(ev.target.value)} className={select}>
              <option value="">None</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  Version {v.versionNumber} · {v.status === 'pdf_ready' ? 'PDF ready' : 'approved'}
                </option>
              ))}
            </select>
            {versions.length === 0 && <p className="mt-1 text-xs text-brand-800">No approved versions yet; you can link one later.</p>}
          </div>
        </div>
      )}

      <form onSubmit={submit} noValidate className="space-y-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold text-slate-900">Job</legend>
          <FormField id="companyName" label="Company *" value={form.companyName} onChange={set('companyName')} error={e('companyName')} maxLength={120} required />
          <FormField id="jobTitle" label="Job title *" value={form.jobTitle} onChange={set('jobTitle')} error={e('jobTitle')} maxLength={150} required />
          <FormField id="location" label="Location" value={form.location} onChange={set('location')} error={e('location')} maxLength={150} />
          <div>
            <label htmlFor="employmentType" className="block text-sm font-medium text-slate-700">
              Employment type
            </label>
            <select id="employmentType" value={form.employmentType} onChange={set('employmentType')} className={select}>
              <option value="">—</option>
              {Object.entries(EMPLOYMENT_TYPES).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <FormField id="jobUrl" label="Job URL" type="url" value={form.jobUrl} onChange={set('jobUrl')} error={e('jobUrl')} placeholder="https://" maxLength={2048} />
          </div>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-4">
          <legend className="mb-2 text-sm font-semibold text-slate-900">Salary range</legend>
          <FormField id="salaryMin" label="Minimum" type="number" min="0" value={form.salaryMin} onChange={set('salaryMin')} error={e('salary.min')} />
          <FormField id="salaryMax" label="Maximum" type="number" min="0" value={form.salaryMax} onChange={set('salaryMax')} error={e('salary.max')} />
          <FormField id="salaryCurrency" label="Currency" value={form.salaryCurrency} onChange={set('salaryCurrency')} error={e('salary.currency')} placeholder="INR" maxLength={3} />
          <div>
            <label htmlFor="salaryPeriod" className="block text-sm font-medium text-slate-700">
              Period
            </label>
            <select id="salaryPeriod" value={form.salaryPeriod} onChange={set('salaryPeriod')} className={select}>
              <option value="">—</option>
              {Object.entries(SALARY_PERIODS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-3">
          <legend className="mb-2 text-sm font-semibold text-slate-900">Experience required</legend>
          <FormField id="expMin" label="Min years" type="number" min="0" max="60" value={form.expMin} onChange={set('expMin')} error={e('experience.minYears')} />
          <FormField id="expMax" label="Max years" type="number" min="0" max="60" value={form.expMax} onChange={set('expMax')} error={e('experience.maxYears')} />
          <FormField id="expText" label="Details" value={form.expText} onChange={set('expText')} error={e('experience.text')} maxLength={200} />
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-3">
          <legend className="mb-2 text-sm font-semibold text-slate-900">Application</legend>
          <div>
            <label htmlFor="source" className="block text-sm font-medium text-slate-700">
              Source
            </label>
            <select id="source" value={form.source} onChange={set('source')} className={select}>
              <option value="">—</option>
              {Object.entries(SOURCES).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <FormField id="sourceDetail" label="Source detail" value={form.sourceDetail} onChange={set('sourceDetail')} error={e('sourceDetail')} maxLength={150} />
          <FormField id="applicationDate" label="Application date" type="date" value={form.applicationDate} onChange={set('applicationDate')} error={e('applicationDate')} />
          {!editing && (
            <div>
              <label htmlFor="status" className="block text-sm font-medium text-slate-700">
                Status
              </label>
              <select id="status" value={form.status} onChange={set('status')} className={select}>
                <option value="saved">Saved</option>
                <option value="applied">Applied</option>
              </select>
            </div>
          )}
        </fieldset>

        <div>
          <label htmlFor="jobDescription" className="block text-sm font-medium text-slate-700">
            Job description
          </label>
          <textarea id="jobDescription" rows={8} value={form.jobDescription} onChange={set('jobDescription')} maxLength={20000} className={`${select} font-mono text-xs`} aria-invalid={Boolean(e('jobDescription'))} />
          <p className="mt-1 text-xs text-slate-500">Saved with the application, so it is still available if the posting is taken down.</p>
          {e('jobDescription') && <p className="mt-1 text-xs text-red-600">{e('jobDescription')}</p>}
        </div>
        <div>
          <label htmlFor="notes" className="block text-sm font-medium text-slate-700">
            Notes
          </label>
          <textarea id="notes" rows={4} value={form.notes} onChange={set('notes')} maxLength={5000} className={select} />
          {e('notes') && <p className="mt-1 text-xs text-red-600">{e('notes')}</p>}
        </div>

        <div className="flex justify-end gap-3">
          <Link to={editing ? `/applications/${id}` : '/applications'} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Cancel
          </Link>
          <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-900 disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {editing ? 'Save changes' : 'Add application'}
          </button>
        </div>
      </form>
    </div>
  );
}
