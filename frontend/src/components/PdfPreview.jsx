import { useEffect, useState } from 'react';
import { AlertCircle, ExternalLink, Loader2 } from 'lucide-react';
import { fetchMasterResumePdf } from '../services/masterResume.service';

/**
 * Shows a stored PDF (the master resume by default, or any authenticated fetcher). The bytes come from the authenticated backend stream
 * (never a public URL) and are displayed through a temporary blob: URL.
 * `version` changes when the file is replaced, which reloads the preview.
 */
export default function PdfPreview({ version, fetchPdf = fetchMasterResumePdf, title = 'Master resume preview' }) {
  const [state, setState] = useState({ status: 'loading', url: null, error: null });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl;
    setState({ status: 'loading', url: null, error: null });
    fetchPdf({ signal: controller.signal })
      .then((blob) => {
        objectUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
        setState({ status: 'ready', url: objectUrl, error: null });
      })
      .catch((err) => {
        if (!controller.signal.aborted) setState({ status: 'error', url: null, error: err });
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, reloadKey]);

  if (state.status === 'loading') {
    return (
      <div className="flex h-[70vh] items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-500" role="status">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> Loading preview…
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-3 rounded-xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-800">
        <AlertCircle className="h-5 w-5" aria-hidden="true" />
        <p>{state.error?.message ?? 'The preview could not be loaded.'}</p>
        <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="rounded-lg border border-red-300 bg-white px-3 py-1.5 font-medium hover:bg-red-100">
          Try again
        </button>
      </div>
    );
  }
  return (
    <div>
      <iframe title={title} src={state.url} className="h-[70vh] w-full rounded-xl border border-slate-200 bg-white" />
      <a href={state.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Open preview in a new tab
      </a>
    </div>
  );
}
