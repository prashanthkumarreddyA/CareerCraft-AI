import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { AlertCircle, AlertTriangle, ArrowRight, BriefcaseBusiness, CalendarClock, Loader2 } from 'lucide-react';
import { fetchDashboard } from '../../services/jobApplication.service';
import { formatDateTime } from '../../utils/format';
import { formatDate, ROUND_TYPES, STATUS_META, STATUS_ORDER, StatusChip } from './meta';

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="text-2xl font-semibold text-slate-900">{value ?? '—'}</p>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/** Small dependency-free bar chart (SVG), with an accessible table fallback. */
function TrendChart({ points, label }) {
  const max = Math.max(1, ...points.map((p) => p.count));
  const w = 28;
  const gap = 8;
  const h = 120;
  return (
    <figure>
      <svg viewBox={`0 -14 ${points.length * (w + gap)} ${h + 36}`} className="h-40 w-full" role="img" aria-label={label}>
        {points.map((p, i) => {
          const bh = Math.round((p.count / max) * h);
          return (
            <g key={p.key}>
              <title>{`${p.label}: ${p.count}`}</title>
              <rect x={i * (w + gap)} y={h - bh} width={w} height={Math.max(bh, p.count ? 2 : 0)} rx="3" className="fill-brand-600" />
              {p.count > 0 && (
                <text x={i * (w + gap) + w / 2} y={h - bh - 4} textAnchor="middle" className="fill-slate-600 text-[10px]">
                  {p.count}
                </text>
              )}
              <text x={i * (w + gap) + w / 2} y={h + 14} textAnchor="middle" className="fill-slate-500 text-[9px]">
                {p.short}
              </text>
            </g>
          );
        })}
        <line x1="0" x2={points.length * (w + gap)} y1={h} y2={h} className="stroke-slate-200" />
      </svg>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {points.map((p) => (
            <tr key={p.key}>
              <th scope="row">{p.label}</th>
              <td>{p.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

const pct = (v) => (v === null || v === undefined ? '—' : `${v}%`);

export default function DashboardApplications() {
  const [state, setState] = useState({ status: 'loading', d: null, error: null });
  const [period, setPeriod] = useState('weekly');
  useEffect(() => {
    fetchDashboard()
      .then((d) => setState({ status: 'ready', d, error: null }))
      .catch((error) => setState({ status: 'error', d: null, error }));
  }, []);

  if (state.status === 'loading') {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-600">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading applications…
      </p>
    );
  }
  if (state.status === 'error') {
    return (
      <p className="flex items-center gap-2 text-sm text-red-700" role="alert">
        <AlertCircle className="h-4 w-4" aria-hidden="true" /> {state.error.message}
      </p>
    );
  }
  const { d } = state;
  const t = d.totals;
  const points =
    period === 'weekly'
      ? d.trends.weekly.map((w) => ({ key: w.start, count: w.count, label: `Week of ${formatDate(w.start)}`, short: new Date(`${w.start}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }) }))
      : d.trends.monthly.map((m) => ({ key: m.month, count: m.count, label: new Date(`${m.month}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }), short: new Date(`${m.month}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' }) }));

  return (
    <section className="space-y-4" aria-labelledby="apps-dashboard-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="apps-dashboard-heading" className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <BriefcaseBusiness className="h-5 w-5 text-brand-700" aria-hidden="true" /> Job applications
        </h2>
        <div className="flex gap-2 text-sm">
          <Link to="/applications/board" className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50">
            Board
          </Link>
          <Link to="/applications" className="inline-flex items-center gap-1 rounded-lg bg-brand-800 px-3 py-1.5 font-medium text-white hover:bg-brand-900">
            All applications <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Total applications" value={t.applications} />
        <Stat label="Interviews scheduled" value={t.interviewsScheduled} hint="upcoming rounds" />
        <Stat label="Offers received" value={t.offers} hint="status Selected" />
        <Stat label="Interview conversion" value={pct(d.rates.interviewConversion)} hint={`${t.reachedInterview} of ${t.reachedApplied} applied`} />
        <Stat label="Selection rate" value={pct(d.rates.selectionRate)} hint={`${t.reachedSelected} of ${t.reachedInterview} interviewed`} />
        <Stat label="Pending follow-ups" value={d.followUps.pendingTotal} hint={d.followUps.overdue.length ? `${d.followUps.overdue.length} overdue` : 'none overdue'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">By status</h3>
          <ul className="space-y-2">
            {STATUS_ORDER.map((s) => (
              <li key={s} className="grid grid-cols-[6rem_1fr_2rem] items-center gap-2 text-sm">
                <Link to={`/applications?status=${s}`} className="text-slate-700 hover:underline">
                  {STATUS_META[s].label}
                </Link>
                <span className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <span className={`block h-full ${STATUS_META[s].dot}`} style={{ width: `${t.applications ? (t.byStatus[s] / t.applications) * 100 : 0}%` }} />
                </span>
                <span className="text-right font-medium text-slate-800">{t.byStatus[s]}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Applications sent</h3>
            <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs" role="group" aria-label="Trend period">
              {['weekly', 'monthly'].map((p) => (
                <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)} className={`rounded-md px-2 py-1 font-medium ${period === p ? 'bg-brand-50 text-brand-800' : 'text-slate-600'}`}>
                  {p === 'weekly' ? 'Weekly' : 'Monthly'}
                </button>
              ))}
            </div>
          </div>
          <TrendChart points={points} label={`Applications per ${period === 'weekly' ? 'week (last 12 weeks)' : 'month (last 12 months)'}, by application date`} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Follow-ups</h3>
          {d.followUps.overdue.length === 0 && d.followUps.upcoming.length === 0 ? (
            <p className="text-sm text-slate-600">Nothing due in the next 14 days.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {[...d.followUps.overdue, ...d.followUps.upcoming].map((f) => (
                <li key={f.followUp.id}>
                  <Link to={`/applications/${f.applicationId}`} className="block rounded-md p-1 hover:bg-slate-50">
                    <span className={`flex items-center gap-1 text-xs font-medium ${f.followUp.overdue ? 'text-red-700' : 'text-slate-600'}`}>
                      {f.followUp.overdue && <AlertTriangle className="h-3 w-3" aria-hidden="true" />}
                      {f.followUp.overdue ? 'Overdue · ' : ''}
                      {formatDate(f.followUp.dueDate)}
                    </span>
                    <span className="text-slate-800">
                      {f.companyName} · {f.jobTitle}
                    </span>
                    {f.followUp.note && <span className="block text-xs text-slate-500">{f.followUp.note}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Upcoming interviews</h3>
          {d.upcomingInterviews.length === 0 ? (
            <p className="text-sm text-slate-600">No interviews scheduled.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {d.upcomingInterviews.map((i) => (
                <li key={i.interview.id}>
                  <Link to={`/applications/${i.applicationId}`} className="block rounded-md p-1 hover:bg-slate-50">
                    <span className="flex items-center gap-1 text-xs font-medium text-violet-700">
                      <CalendarClock className="h-3 w-3" aria-hidden="true" /> {formatDateTime(i.interview.scheduledAt)}
                    </span>
                    <span className="text-slate-800">
                      {i.companyName} · Round {i.interview.round} ({ROUND_TYPES[i.interview.roundType]})
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Recent applications</h3>
          {d.recentApplications.length === 0 ? (
            <p className="text-sm text-slate-600">
              No applications yet.{' '}
              <Link to="/applications/new" className="font-medium text-brand-800 hover:underline">
                Add one
              </Link>
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {d.recentApplications.map((a) => (
                <li key={a.id}>
                  <Link to={`/applications/${a.id}`} className="flex items-center justify-between gap-2 rounded-md p-1 hover:bg-slate-50">
                    <span className="min-w-0 truncate text-slate-800">
                      {a.jobTitle} <span className="text-slate-500">· {a.companyName}</span>
                    </span>
                    <StatusChip status={a.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
