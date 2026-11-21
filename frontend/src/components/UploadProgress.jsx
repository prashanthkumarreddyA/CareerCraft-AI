import { Loader2 } from 'lucide-react';
import { formatBytes } from '../utils/format';

/** phase: 'uploading' (with percent) | 'processing' (server extracting + storing) */
export default function UploadProgress({ file, phase, percent }) {
  const processing = phase === 'processing';
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-4 text-sm">
        <span className="truncate font-medium text-slate-900">{file.name}</span>
        <span className="shrink-0 text-slate-500">{formatBytes(file.size)}</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full bg-brand-700 transition-all ${processing ? 'w-full animate-pulse' : ''}`}
          style={processing ? undefined : { width: `${percent ?? 0}%` }}
        />
      </div>
      <p className="mt-2 flex items-center gap-2 text-xs text-slate-600">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        {processing ? 'Reading your resume and storing it securely…' : `Uploading… ${percent ?? 0}%`}
      </p>
    </div>
  );
}
