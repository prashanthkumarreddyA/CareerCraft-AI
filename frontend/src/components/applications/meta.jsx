// Labels and colours shared by the application tracker pages.

export const STATUS_ORDER = ['saved', 'applied', 'interview', 'selected', 'rejected', 'withdrawn'];

export const STATUS_META = {
  saved: { label: 'Saved', chip: 'border-slate-200 bg-slate-100 text-slate-700', column: 'border-slate-300', dot: 'bg-slate-400' },
  applied: { label: 'Applied', chip: 'border-sky-200 bg-sky-50 text-sky-800', column: 'border-sky-300', dot: 'bg-sky-500' },
  interview: { label: 'Interview', chip: 'border-violet-200 bg-violet-50 text-violet-800', column: 'border-violet-300', dot: 'bg-violet-500' },
  selected: { label: 'Selected', chip: 'border-emerald-200 bg-emerald-50 text-emerald-800', column: 'border-emerald-300', dot: 'bg-emerald-500' },
  rejected: { label: 'Rejected', chip: 'border-red-200 bg-red-50 text-red-800', column: 'border-red-300', dot: 'bg-red-500' },
  withdrawn: { label: 'Withdrawn', chip: 'border-amber-200 bg-amber-50 text-amber-800', column: 'border-amber-300', dot: 'bg-amber-500' },
};

export const EMPLOYMENT_TYPES = { full_time: 'Full-time', part_time: 'Part-time', contract: 'Contract', internship: 'Internship', temporary: 'Temporary', freelance: 'Freelance', other: 'Other' };
export const SOURCES = { linkedin: 'LinkedIn', naukri: 'Naukri', indeed: 'Indeed', company_website: 'Company website', referral: 'Referral', recruiter: 'Recruiter', other: 'Other' };
export const SALARY_PERIODS = { year: 'per year', month: 'per month', hour: 'per hour' };
export const ROUND_TYPES = { phone_screen: 'Phone screen', technical: 'Technical', system_design: 'System design', hr: 'HR', managerial: 'Managerial', take_home: 'Take-home', other: 'Other' };
export const RESULTS = { pending: 'Pending', passed: 'Passed', failed: 'Failed', no_show: 'No-show' };

export function StatusChip({ status, className = '' }) {
  const meta = STATUS_META[status] ?? STATUS_META.saved;
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${meta.chip} ${className}`}>{meta.label}</span>;
}

/** "2026-11-21" → localised date without time-zone shifts (calendar dates are UTC midnight). */
export function formatDate(value) {
  if (!value) return '—';
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: 'UTC' });
}

export function formatSalary(salary) {
  if (!salary || (salary.min === null && salary.max === null)) return '—';
  const fmt = (n) => (n === null || n === undefined ? '' : new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n));
  const range = salary.min !== null && salary.max !== null ? `${fmt(salary.min)} – ${fmt(salary.max)}` : fmt(salary.min ?? salary.max);
  return [salary.currency, range, salary.period ? SALARY_PERIODS[salary.period] : ''].filter(Boolean).join(' ');
}

export function formatExperience(exp) {
  if (!exp) return '—';
  const { minYears: a, maxYears: b, text } = exp;
  const range = a !== null && b !== null ? `${a}–${b} years` : a !== null ? `${a}+ years` : b !== null ? `up to ${b} years` : '';
  return [range, text].filter(Boolean).join(' · ') || '—';
}

/** Today's calendar date in the browser's time zone, as YYYY-MM-DD. */
export const todayLocal = () => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** <input type="datetime-local"> value ↔ ISO string with the browser's offset. */
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fromLocalInput(value) {
  if (!value) return null;
  const d = new Date(value); // interpreted in local time
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Server validation details → { field: message } (for forms). */
export const fieldErrors = (err) => Object.fromEntries((err?.details ?? []).filter((d) => d.path).map((d) => [d.path, d.message]));
