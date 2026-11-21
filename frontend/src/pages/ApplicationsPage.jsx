import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AlertCircle, BriefcaseBusiness, CalendarClock, Download, KanbanSquare, Loader2, Plus, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { downloadCsv, listApplications } from '../services/jobApplication.service';
import { formatDate, SOURCES, STATUS_META, STATUS_ORDER, StatusChip } from '../components/applications/meta';

const SORTS = { updatedAt: 'Last updated', applicationDate: 'Application date', createdAt: 'Date added', companyName: 'Company', jobTitle: 'Job title' };
const input = 'block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100';

/** Filters live in the URL so a filtered list can be bookmarked and survives a reload. */
function useFilters() {
  const [params, setParams] = useSearchParams();
  const filters = {
    q: params.get('q') ?? '',
    status: (params.get('status') ?? '').split(',').filter((s) => STATUS_ORDER.includes(s)),
    location: params.get('location') ?? '',
    source: params.get('source') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    sort: SORTS[params.get('sort')] ? params.get('sort') : 'updatedAt',
    order: params.get('order') === 'asc' ? 'asc' : 'desc',
    page: Math.max(1, Number(params.get('page')) || 1),
  };
  const update = (patch) => {
    const next = { ...filters, page: 1, ...patch };
    const out = {};
    for (const [k, v] of Object.entries(next)) {
      const value = Array.isArray(v) ? v.join(',') : String(v ?? '');
      if (value && !(k === 'sort' && value === 'updatedAt') && !(k === 'order' && value === 'desc') && !(k === 'page' && value === '1')) out[k] = value;
    }
    setParams(out, { replace: true });
  };
  return [filters, update];
}

export default function ApplicationsPage() {
  const [filters, update] = useFilters();
  const [search, setSearch] = useState(filters.q);
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [exporting, setExporting] = useState(false);
  const key = JSON.stringify(filters);

  const load = useCallback(() => {
    setState((s) => ({ ...s, status: 'loading' }));
    listApplications({ ...JSON.parse(key), limit: 20 })
      .then((data) => setState({ status: 'ready', data, error: null }))
      .catch((error) => setState({ status: 'error', data: null, error }));
  }, [key]);
  useEffect(load, [load]);

  // Debounced search box.
  useEffect(() => {
    if (search === filters.q) return undefined;
    const t = setTimeout(() => update({ q: search.trim() }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function exportCsv() {
    setExporting(true);
    try {
      await downloadCsv(filters);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setExporting(false);
    }
  }

  const toggleStatus = (s) => update({ status: filters.status.includes(s) ? filters.status.filter((x) => x !== s) : [...filters.status, s] });
  const data = state.data;
  const filtered = filters.q || filters.status.length || filters.location || filters.source || filters.from || filters.to;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Job applications</h1>
          <p className="text-sm text-slate-600">Track every application, its interviews and follow-ups.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/applications/board" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <KanbanSquare className="h-4 w-4" aria-hidden="true" /> Board
          </Link>
          <button type="button" onClick={exportCsv} disabled={exporting || !data?.total} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />} Export CSV
          </button>
          <Link to="/applications/new" className="inline-flex items-center gap-1.5 rounded-lg bg-brand-800 px-3 py-2 text-sm font-medium text-white hover:bg-brand-900">
            <Plus className="h-4 w-4" aria-hidden="true" /> New application
          </Link>
        </div>
      </div>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Search and filters">
        <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr]">
          <label className="relative block">
            <span className="sr-only">Search company or job title</span>
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search company or job title" className={`${input} pl-9`} maxLength={100} />
          </label>
          <label className="block">
            <span className="sr-only">Location</span>
            <input value={filters.location} onChange={(e) => update({ location: e.target.value })} placeholder="Location" className={input} maxLength={150} />
          </label>
          <label className="block">
            <span className="sr-only">Source</span>
            <select value={filters.source} onChange={(e) => update({ source: e.target.value })} className={input}>
              <option value="">All sources</option>
              {Object.entries(SOURCES).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Status">
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={filters.status.includes(s)}
              onClick={() => toggleStatus(s)}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${filters.status.includes(s) ? STATUS_META[s].chip : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              {STATUS_META[s].label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Applied from</span>
            <input type="date" value={filters.from} onChange={(e) => update({ from: e.target.value })} className={input} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">to</span>
            <input type="date" value={filters.to} onChange={(e) => update({ to: e.target.value })} className={input} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Sort by</span>
            <select value={filters.sort} onChange={(e) => update({ sort: e.target.value })} className={input}>
              {Object.entries(SORTS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Order</span>
            <select value={filters.order} onChange={(e) => update({ order: e.target.value })} className={input}>
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </label>
          {filtered && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                update({ q: '', status: [], location: '', source: '', from: '', to: '' });
              }}
              className="rounded-lg px-3 py-2 text-sm font-medium text-brand-800 hover:bg-brand-50"
            >
              Clear filters
            </button>
          )}
        </div>
      </section>

      {state.status === 'error' && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p>{state.error.message}</p>
            <button type="button" onClick={load} className="mt-1 font-medium underline">
              Try again
            </button>
          </div>
        </div>
      )}

      {state.status === 'loading' && !data && (
        <p className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading applications…
        </p>
      )}

      {data && (
        <section aria-label="Applications" className={state.status === 'loading' ? 'opacity-60' : ''}>
          <p className="mb-2 text-sm text-slate-600" aria-live="polite">
            {data.total} application{data.total === 1 ? '' : 's'}
            {filtered ? ' match the filters' : ''}
          </p>
          {data.items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
              <BriefcaseBusiness className="mx-auto mb-2 h-6 w-6 text-slate-400" aria-hidden="true" />
              {filtered ? 'No applications match these filters.' : 'No applications yet. Add one, or track a job from a saved analysis.'}
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              {data.items.map((a) => (
                <li key={a.id}>
                  <Link to={`/applications/${a.id}`} className="grid gap-1 px-4 py-3 hover:bg-slate-50 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">
                        {a.jobTitle} <span className="font-normal text-slate-500">· {a.companyName}</span>
                      </p>
                      <p className="flex flex-wrap gap-x-3 text-xs text-slate-500">
                        {a.location && <span>{a.location}</span>}
                        {a.source && <span>{SOURCES[a.source]}</span>}
                        <span>Applied {formatDate(a.applicationDate)}</span>
                        {a.nextInterview && (
                          <span className="inline-flex items-center gap-1 text-violet-700">
                            <CalendarClock className="h-3 w-3" aria-hidden="true" /> Interview {new Date(a.nextInterview.scheduledAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                          </span>
                        )}
                        {a.overdueFollowUps > 0 && <span className="font-medium text-red-700">{a.overdueFollowUps} overdue follow-up{a.overdueFollowUps > 1 ? 's' : ''}</span>}
                      </p>
                    </div>
                    <StatusChip status={a.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {data.totalPages > 1 && (
            <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination">
              <button type="button" disabled={data.page <= 1} onClick={() => update({ page: data.page - 1 })} className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-40">
                Previous
              </button>
              <span className="text-slate-600">
                Page {data.page} of {data.totalPages}
              </span>
              <button type="button" disabled={data.page >= data.totalPages} onClick={() => update({ page: data.page + 1 })} className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-40">
                Next
              </button>
            </nav>
          )}
        </section>
      )}
    </div>
  );
}
