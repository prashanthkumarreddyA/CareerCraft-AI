import { useBackendStatus } from '../context/BackendStatusContext';

const STYLES = {
  checking: ['bg-slate-100 text-slate-600', 'bg-slate-400 animate-pulse', 'Connecting…'],
  waking: ['bg-amber-50 text-amber-800', 'bg-amber-500 animate-pulse', 'Waking server…'],
  online: ['bg-emerald-50 text-emerald-800', 'bg-emerald-500', 'API online'],
  offline: ['bg-red-50 text-red-700', 'bg-red-500', 'API offline'],
  misconfigured: ['bg-red-50 text-red-700', 'bg-red-500', 'API not configured'],
};

export default function ApiStatusBadge() {
  const { status } = useBackendStatus();
  const [pill, dot, label] = STYLES[status];
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${pill}`} role="status" aria-live="polite">
      <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
      {label}
    </span>
  );
}
