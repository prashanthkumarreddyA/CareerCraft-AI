import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import FormField from '../components/FormField';

const COPY = {
  login: { title: 'Sign in', submit: 'Sign in', alt: ["Don't have an account?", '/register', 'Create one'] },
  register: { title: 'Create your account', submit: 'Create account', alt: ['Already have an account?', '/login', 'Sign in'] },
};

/** Sign-in and sign-up share one form; `mode` selects the fields and the API call. */
export default function AuthPage({ mode }) {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const copy = COPY[mode];

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  function validate() {
    const next = {};
    if (mode === 'register' && !form.name.trim()) next.name = 'Name is required.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) next.email = 'Enter a valid email address.';
    if (mode === 'register' && form.password.length < 8) next.password = 'Use at least 8 characters.';
    if (mode === 'login' && !form.password) next.password = 'Password is required.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      if (mode === 'register') await register({ name: form.name.trim(), email: form.email.trim(), password: form.password });
      else await login({ email: form.email.trim(), password: form.password });
      navigate(location.state?.from ?? '/', { replace: true });
    } catch (err) {
      if (err.code === 'VALIDATION_ERROR' && Array.isArray(err.details)) {
        setErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
      } else {
        toast.error(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto mt-10 max-w-sm">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-xl font-semibold text-slate-900">{copy.title}</h1>
        <form className="mt-6 space-y-4" onSubmit={onSubmit} noValidate>
          {mode === 'register' && <FormField id="name" label="Full name" autoComplete="name" value={form.name} onChange={update('name')} error={errors.name} />}
          <FormField id="email" label="Email" type="email" autoComplete="email" value={form.email} onChange={update('email')} error={errors.email} />
          <FormField
            id="password"
            label="Password"
            type="password"
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            value={form.password}
            onChange={update('password')}
            error={errors.password}
          />
          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-800 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-900 disabled:opacity-60"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {copy.submit}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-slate-600">
          {copy.alt[0]}{' '}
          <Link to={copy.alt[1]} state={location.state} className="font-medium text-brand-700 hover:underline">
            {copy.alt[2]}
          </Link>
        </p>
      </div>
    </div>
  );
}
