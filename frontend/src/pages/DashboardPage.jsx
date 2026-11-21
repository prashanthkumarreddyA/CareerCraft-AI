import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Database, Loader2, RefreshCw, Server, AlertCircle, FileText, ArrowRight, ScanSearch } from 'lucide-react';
import { useBackendStatus } from '../context/BackendStatusContext';
import { useMasterResume } from '../hooks/useMasterResume';
import { API_URL } from '../utils/env';
import { formatDateTime } from '../utils/format';
import { listJobAnalyses } from '../services/jobAnalysis.service';
import DashboardApplications from '../components/applications/DashboardApplications';

function MasterResumeCard() {
  const { status, resume, error } = useMasterResume();
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-800">
            <FileText className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold text-slate-900">Master resume</h2>
            {status === 'loading' && <p className="text-sm text-slate-500">Checking…</p>}
            {status === 'error' && <p className="text-sm text-red-700">{error?.message}</p>}
            {status === 'ready' && !resume && <p className="text-sm text-slate-600">Not uploaded yet. Upload your original resume PDF to get started.</p>}
            {status === 'ready' && resume && (
              <p className="truncate text-sm text-slate-600">
                <span className="font-medium text-slate-900">{resume.originalFileName}</span> · uploaded {formatDateTime(resume.uploadedAt)}
              </p>
            )}
          </div>
        </div>
        <Link to="/master-resume" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-900">
          {status === 'ready' && !resume ? 'Upload' : 'Manage'} <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

function JobAnalysisCard() {
  const [state, setState] = useState({ status: 'loading', total: 0, latest: null });
  useEffect(() => {
    let active = true;
    listJobAnalyses({ limit: 1 })
      .then((d) => active && setState({ status: 'ready', total: d.total, latest: d.items[0] ?? null }))
      .catch(() => active && setState({ status: 'error', total: 0, latest: null }));
    return () => {
      active = false;
    };
  }, []);
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-800">
            <ScanSearch className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold text-slate-900">Job description analysis</h2>
            {state.status === 'loading' && <p className="text-sm text-slate-500">Checking…</p>}
            {state.status === 'error' && <p className="text-sm text-slate-500">Saved analyses could not be loaded.</p>}
            {state.status === 'ready' && !state.latest && <p className="text-sm text-slate-600">Compare a job description with your master resume.</p>}
            {state.status === 'ready' && state.latest && (
              <p className="truncate text-sm text-slate-600">
                {state.total} saved · latest: <span className="font-medium text-slate-900">{state.latest.jobTitle}</span> at {state.latest.companyName} ({state.latest.matchPercentage}%)
              </p>
            )}
          </div>
        </div>
        <Link to="/job-analysis" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-900">
          Analyse <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

const DB_LABELS = {
  connected: ['Connected', 'text-emerald-700'],
  connecting: ['Connecting…', 'text-amber-700'],
  disconnected: ['Disconnected', 'text-red-700'],
  disconnecting: ['Disconnecting', 'text-amber-700'],
  not_configured: ['Not configured', 'text-slate-500'],
};

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-900">{children}</dd>
    </div>
  );
}

export default function DashboardPage() {
  const { status, health, error, checkedAt, recheck } = useBackendStatus();
  const busy = status === 'checking' || status === 'waking';
  const [dbLabel, dbClass] = DB_LABELS[health?.dependencies?.database] ?? ['—', 'text-slate-500'];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">Your applications, master resume, job description analyses and system status.</p>
      </div>

      <DashboardApplications />
      <MasterResumeCard />
      <JobAnalysisCard />

      {status === 'waking' && (
        <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
          <p>The server is waking up. The free hosting tier sleeps after inactivity, so the first request can take up to a minute.</p>
        </div>
      )}
      {status === 'offline' && (
        <div className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{error?.message ?? 'The API is not responding.'} </p>
        </div>
      )}
      {status === 'misconfigured' && (
        <div className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>VITE_API_URL is not set for this build. Configure it in the hosting environment and redeploy.</p>
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="flex items-center gap-2 font-semibold text-slate-900">
            <Server className="h-4 w-4 text-brand-700" aria-hidden="true" />
            System status
          </h2>
          <button
            type="button"
            onClick={recheck}
            disabled={busy || status === 'misconfigured'}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />
            Check again
          </button>
        </div>
        <dl className="divide-y divide-slate-100 px-5">
          <Row label="API endpoint">
            <span className="font-mono text-xs">{API_URL || 'not set'}</span>
          </Row>
          <Row label="API">{status === 'online' ? `Online (${health.latencyMs} ms)` : status === 'offline' ? 'Unreachable' : '…'}</Row>
          <Row label="Database">
            <span className={`inline-flex items-center gap-1.5 ${dbClass}`}>
              <Database className="h-3.5 w-3.5" aria-hidden="true" />
              {dbLabel}
            </span>
          </Row>
          <Row label="Environment">{health?.environment ?? '—'}</Row>
          <Row label="API version">{health?.version ?? '—'}</Row>
          <Row label="Last checked">{checkedAt ? checkedAt.toLocaleTimeString() : '—'}</Row>
        </dl>
      </section>
    </div>
  );
}
