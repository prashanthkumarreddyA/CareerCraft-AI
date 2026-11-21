const DEV_DEFAULT_API_URL = 'http://localhost:5000/api';

/**
 * Normalises the API base URL. The backend serves every route under /api, so a bare backend URL
 * ("https://api.example.com") gets "/api" appended; a URL that already ends in /api is kept
 * (never doubled). Trailing slashes are removed.
 */
export function normalizeApiUrl(value) {
  const configured = String(value ?? '').trim().replace(/\/+$/, '');
  if (!configured) return '';
  try {
    const url = new URL(configured);
    if (url.pathname === '' || url.pathname === '/') return `${url.origin}/api`;
  } catch {
    // not an absolute URL (e.g. a relative "/api" proxy path): use as given
  }
  return configured;
}

function resolveApiUrl() {
  const configured = normalizeApiUrl(import.meta.env.VITE_API_URL);
  if (configured) return configured;
  if (import.meta.env.DEV) return DEV_DEFAULT_API_URL;
  return ''; // production build without VITE_API_URL: surfaced as a configuration error in the UI
}

export const API_URL = resolveApiUrl();
export const isApiConfigured = Boolean(API_URL);
