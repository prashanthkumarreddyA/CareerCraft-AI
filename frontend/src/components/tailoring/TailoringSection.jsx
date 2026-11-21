import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { FilePen, Loader2, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import { createTailoredResume, listTailoredResumes } from '../../services/tailoredResume.service';
import { formatDateTime } from '../../utils/format';

const STATUS_LABEL = { draft: 'Draft', approved: 'Approved', pdf_ready: 'PDF ready' };

/** Version history for one job analysis + "create a tailored version". */
export default function TailoringSection({ analysisId, stale = false }) {
  const navigate = useNavigate();
  const [items, setItems] = useState(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    listTailoredResumes(analysisId)
      .then(setItems)
      .catch(() => setItems([]));
  }, [analysisId]);
  useEffect(load, [load]);

  async function create() {
    setCreating(true);
    setError(null);
    try {
      const version = await createTailoredResume(analysisId);
      toast.success(`Version ${version.versionNumber} is ready for review.`);
      navigate(`/tailored-resumes/${version.id}`);
    } catch (err) {
      setError(err);
      toast.error(err.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="tailoring-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="tailoring-heading" className="flex items-center gap-2 font-semibold text-slate-900">
            <FilePen className="h-4 w-4 text-brand-700" aria-hidden="true" /> Tailored resumes
          </h2>
          <p className="text-sm text-slate-600">Proposes wording and ordering changes backed by your master resume. You review every change; your master resume is never modified.</p>
        </div>
        <button
          type="button"
          onClick={create}
          disabled={creating || stale}
          title={stale ? 'This analysis is outdated: run a new analysis first' : undefined}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-900 disabled:opacity-60">
          {creating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
          {creating ? 'Preparing suggestions…' : 'Create tailored version'}
        </button>
      </div>
      {creating && <p className="mt-2 text-sm text-slate-600">The AI drafts suggestions and the fact checker verifies each one. This can take up to a few minutes.</p>}
      {error && <p className="mt-2 text-sm text-red-700">{error.message}</p>}
      {items?.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100">
          {items.map((v) => (
            <li key={v.id}>
              <Link to={`/tailored-resumes/${v.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-2 hover:bg-slate-50">
                <span className="font-medium text-slate-900">Version {v.versionNumber}</span>
                <span className="text-xs text-slate-500">
                  {STATUS_LABEL[v.status]} · {v.progress.total - v.progress.pending}/{v.progress.total} decided
                  {v.progress.overrides ? ` · ${v.progress.overrides} override(s)` : ''}
                  {v.masterChanged ? ' · outdated (master resume changed)' : ''} · {formatDateTime(v.createdAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
