const DEV_DEFAULT_API_URL = 'http://localhost:5000/api';

function resolveApiUrl() {
  const configured = (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  if (import.meta.env.DEV) return DEV_DEFAULT_API_URL;
  return ''; // production build without VITE_API_URL: surfaced as a configuration error in the UI
}

export const API_URL = resolveApiUrl();
export const isApiConfigured = Boolean(API_URL);
