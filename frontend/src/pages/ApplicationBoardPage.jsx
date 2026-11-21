import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { AlertCircle, CalendarClock, List, Loader2, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { changeStatus, fetchBoard, undoStatus } from '../services/jobApplication.service';
import { formatDate, STATUS_META, STATUS_ORDER } from '../components/applications/meta';

/**
 * Kanban board. Drag-and-drop uses the browser's native API (no extra dependency); every card also
 * has a "Move to…" menu so keyboard and touch users can change the status. Only moves the
 * pipeline allows are offered; the server enforces the same rules.
 */
function Card({ app, busy, onMove, onDragStart, onDragEnd }) {
  return (
    <li
      draggable={!busy && app.allowedStatuses.length > 0}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', app.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(app);
      }}
      onDragEnd={onDragEnd}
      data-application-id={app.id}
      className={`rounded-lg border border-slate-200 bg-white p-3 shadow-sm ${app.allowedStatuses.length ? 'cursor-grab active:cursor-grabbing' : ''} ${busy ? 'opacity-60' : ''}`}
    >
      <Link to={`/applications/${app.id}`} className="block font-medium text-slate-900 hover:text-brand-800">
        {app.jobTitle}
      </Link>
      <p className="text-sm text-slate-600">{app.companyName}</p>
      <p className="mt-1 text-xs text-slate-500">{app.applicationDate ? `Applied ${formatDate(app.applicationDate)}` : 'Not applied yet'}</p>
      {app.nextInterview && (
        <p className="mt-1 flex items-center gap-1 text-xs text-violet-700">
          <CalendarClock className="h-3 w-3" aria-hidden="true" />
          {new Date(app.nextInterview.scheduledAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
        </p>
      )}
      {app.overdueFollowUps > 0 && <p className="mt-1 text-xs font-medium text-red-700">{app.overdueFollowUps} overdue follow-up{app.overdueFollowUps > 1 ? 's' : ''}</p>}
      {app.allowedStatuses.length > 0 && (
        <label className="mt-2 block">
          <span className="sr-only">Move {app.jobTitle} at {app.companyName} to</span>
          <select
            value=""
            disabled={busy}
            onChange={(e) => e.target.value && onMove(app, e.target.value)}
            className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700"
          >
            <option value="">Move to…</option>
            {app.allowedStatuses.map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
              </option>
            ))}
          </select>
        </label>
      )}
    </li>
  );
}

export default function ApplicationBoardPage() {
  const [state, setState] = useState({ status: 'loading', board: null, error: null });
  const [dragged, setDragged] = useState(null);
  const [over, setOver] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    fetchBoard()
      .then((board) => setState({ status: 'ready', board, error: null }))
      .catch((error) => setState({ status: 'error', board: null, error }));
  }, []);
  useEffect(load, [load]);

  const replaceCard = (board, updated) => {
    const columns = Object.fromEntries(Object.entries(board.columns).map(([k, list]) => [k, list.filter((c) => c.id !== updated.id)]));
    columns[updated.status] = [updated, ...columns[updated.status]];
    return { ...board, columns };
  };
  const summaryOf = (a, prev) => ({ ...prev, status: a.status, allowedStatuses: a.allowedStatuses, applicationDate: a.applicationDate, revision: a.revision, updatedAt: a.updatedAt });

  async function onMove(card, to) {
    if (!card.allowedStatuses.includes(to)) {
      toast.error(`${STATUS_META[card.status].label} → ${STATUS_META[to].label} is not allowed.`);
      return;
    }
    setBusyId(card.id);
    try {
      const updated = await changeStatus(card.id, to, card.revision);
      const moved = summaryOf(updated, card);
      setState((s) => ({ ...s, board: replaceCard(s.board, moved) }));
      toast(
        (t) => (
          <span className="flex items-center gap-3 text-sm">
            Moved to {STATUS_META[to].label}.
            <button
              type="button"
              className="font-medium text-brand-800 underline"
              onClick={async () => {
                toast.dismiss(t.id);
                try {
                  const reverted = await undoStatus(card.id, updated.revision);
                  setState((s) => ({ ...s, board: replaceCard(s.board, summaryOf(reverted, moved)) }));
                } catch (err) {
                  toast.error(err.message);
                  load();
                }
              }}
            >
              Undo
            </button>
          </span>
        ),
        { duration: 6000 },
      );
    } catch (err) {
      toast.error(err.message);
      if (err.code === 'REVISION_CONFLICT') load();
    } finally {
      setBusyId(null);
    }
  }

  const board = state.board;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Application board</h1>
          <p className="text-sm text-slate-600">Drag a card to change its status, or use its “Move to…” menu.</p>
        </div>
        <div className="flex gap-2">
          <Link to="/applications" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <List className="h-4 w-4" aria-hidden="true" /> List
          </Link>
          <Link to="/applications/new" className="inline-flex items-center gap-1.5 rounded-lg bg-brand-800 px-3 py-2 text-sm font-medium text-white hover:bg-brand-900">
            <Plus className="h-4 w-4" aria-hidden="true" /> New application
          </Link>
        </div>
      </div>

      {state.status === 'loading' && (
        <p className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading board…
        </p>
      )}
      {state.status === 'error' && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{state.error.message}</p>
        </div>
      )}
      {board?.truncated && <p className="text-sm text-amber-800">Showing the {board.total} most recently updated applications. Use the list view to see all.</p>}

      {board && (
        <div className="-mx-4 overflow-x-auto px-4 pb-2">
          <div className="grid min-w-[1080px] grid-cols-6 gap-3">
            {STATUS_ORDER.map((status) => {
              const allowed = !dragged || dragged.status === status || dragged.allowedStatuses.includes(status);
              const target = dragged && dragged.status !== status && dragged.allowedStatuses.includes(status);
              return (
                <section
                  key={status}
                  aria-label={`${STATUS_META[status].label} (${board.columns[status].length})`}
                  data-status={status}
                  onDragOver={(e) => {
                    if (!target) return; // no drop allowed: the browser shows the "not allowed" cursor
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setOver(status);
                  }}
                  onDragLeave={() => setOver((o) => (o === status ? null : o))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setOver(null);
                    const card = dragged;
                    setDragged(null);
                    if (card && target) onMove(card, status);
                  }}
                  className={`flex min-h-[320px] flex-col rounded-xl border-t-4 bg-slate-100/70 p-2 transition ${STATUS_META[status].column} ${allowed ? '' : 'opacity-40'} ${over === status ? 'ring-2 ring-brand-400' : ''}`}
                >
                  <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-semibold text-slate-800">
                    {STATUS_META[status].label}
                    <span className="rounded-full bg-white px-2 text-xs font-medium text-slate-600">{board.columns[status].length}</span>
                  </h2>
                  <ul className="flex flex-1 flex-col gap-2">
                    {board.columns[status].map((app) => (
                      <Card key={app.id} app={app} busy={busyId === app.id} onMove={onMove} onDragStart={setDragged} onDragEnd={() => (setDragged(null), setOver(null))} />
                    ))}
                    {board.columns[status].length === 0 && <li className="rounded-lg border border-dashed border-slate-300 p-3 text-center text-xs text-slate-500">No applications</li>}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
