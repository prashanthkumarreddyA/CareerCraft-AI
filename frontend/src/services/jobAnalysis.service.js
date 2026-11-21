import { api } from './api';

// The AI call can take a while (model latency, retries, a cold-starting server). The backend
// gives up after ~170 s; the client waits slightly longer so it receives the server's error.
const ANALYSIS_TIMEOUT_MS = 200_000;

export async function createJobAnalysis({ companyName, jobTitle, jobDescription }, { signal } = {}) {
  const { data } = await api.post('/job-analysis', { companyName, jobTitle, jobDescription }, { timeout: ANALYSIS_TIMEOUT_MS, signal });
  return data.data.jobAnalysis;
}

export async function listJobAnalyses({ page = 1, limit = 20 } = {}) {
  const { data } = await api.get('/job-analysis', { params: { page, limit } });
  return data.data;
}

export async function fetchJobAnalysis(id) {
  const { data } = await api.get(`/job-analysis/${encodeURIComponent(id)}`);
  return data.data.jobAnalysis;
}

export async function deleteJobAnalysis(id) {
  await api.delete(`/job-analysis/${encodeURIComponent(id)}`);
}
