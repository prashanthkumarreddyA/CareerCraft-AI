import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { FileText, LogOut } from 'lucide-react';
import ApiStatusBadge from '../components/ApiStatusBadge';
import { useAuth } from '../context/AuthContext';

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/master-resume', label: 'Master resume' },
  { to: '/job-analysis', label: 'Job analysis' },
  { to: '/applications', label: 'Applications' },
];

export default function AppLayout() {
  const { user, status, logout } = useAuth();
  const navigate = useNavigate();
  const signedIn = status === 'signed_in' && user;

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-6">
            <Link to="/" className="flex shrink-0 items-center gap-2 font-semibold text-brand-900">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-800 text-white">
                <FileText className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="hidden sm:inline">CareerCraft AI</span>
            </Link>
            {signedIn && (
              <nav className="flex min-w-0 items-center gap-1 overflow-x-auto" aria-label="Main">
                {NAV.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      `whitespace-nowrap rounded-lg px-2 py-1.5 text-sm font-medium sm:px-3 ${isActive ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-slate-100'}`
                    }
                  >
                    {item.label}
                  </NavLink>
                ))}
              </nav>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <ApiStatusBadge />
            {signedIn && (
              <>
                <span className="hidden text-sm text-slate-600 md:inline">{user.name}</span>
                <button
                  type="button"
                  onClick={async () => {
                    await logout();
                    navigate('/login', { replace: true });
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Sign out</span>
                </button>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
