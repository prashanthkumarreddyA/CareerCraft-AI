import { Navigate, Outlet, useLocation } from 'react-router';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

function FullPageSpinner() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center text-slate-500" role="status">
      <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/** Pages that need a signed-in user. */
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'verifying') return <FullPageSpinner />;
  if (status === 'signed_out') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

/** Sign-in/sign-up pages: signed-in users go straight to the app. */
export function GuestOnly() {
  const { status } = useAuth();
  if (status === 'verifying') return <FullPageSpinner />;
  if (status === 'signed_in') return <Navigate to="/" replace />;
  return <Outlet />;
}
