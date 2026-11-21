import { api } from './api';

/** GET /api/health → { status, service, version, environment, uptimeSeconds, timestamp, dependencies } */
export async function fetchHealth({ signal, timeout } = {}) {
  const started = performance.now();
  const { data } = await api.get('/health', { signal, timeout });
  return { ...data.data, latencyMs: Math.round(performance.now() - started) };
}
