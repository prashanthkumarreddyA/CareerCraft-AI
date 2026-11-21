import { api } from './api';

// Generation calls the AI (possibly twice: proposals + one repair round).
const GENERATION_TIMEOUT_MS = 240_000;

export async function createTailoredResume(jobAnalysisId) {
  const { data } = await api.post(`/job-analysis/${encodeURIComponent(jobAnalysisId)}/tailored-resumes`, null, { timeout: GENERATION_TIMEOUT_MS });
  return data.data.tailoredResume;
}

export async function listTailoredResumes(jobAnalysisId) {
  const url = jobAnalysisId ? `/job-analysis/${encodeURIComponent(jobAnalysisId)}/tailored-resumes` : '/tailored-resumes';
  const { data } = await api.get(url);
  return data.data.items;
}

export async function fetchTailoredResume(id) {
  const { data } = await api.get(`/tailored-resumes/${encodeURIComponent(id)}`);
  return data.data.tailoredResume;
}

/** decision: accept (optional confirmReview) | reject | reset | edit (with text, optional confirmOverride / confirmReview). */
export async function decideChange(id, changeId, body) {
  const { data } = await api.patch(`/tailored-resumes/${encodeURIComponent(id)}/changes/${encodeURIComponent(changeId)}`, body);
  return data.data.tailoredResume;
}

export async function acceptAllChanges(id, expectedRevision) {
  const { data } = await api.post(`/tailored-resumes/${encodeURIComponent(id)}/accept-all`, { expectedRevision });
  return data.data.tailoredResume;
}

export async function approveTailoredResume(id, expectedRevision) {
  const { data } = await api.post(`/tailored-resumes/${encodeURIComponent(id)}/approve`, { expectedRevision });
  return data.data.tailoredResume;
}

export async function duplicateTailoredResume(id) {
  const { data } = await api.post(`/tailored-resumes/${encodeURIComponent(id)}/duplicate`);
  return data.data.tailoredResume;
}

export async function deleteTailoredResume(id) {
  await api.delete(`/tailored-resumes/${encodeURIComponent(id)}`);
}

export async function generateTailoredPdf(id) {
  const { data } = await api.post(`/tailored-resumes/${encodeURIComponent(id)}/pdf`, null, { timeout: 120_000 });
  return data.data.tailoredResume;
}

export async function fetchTailoredPdf(id, { signal } = {}) {
  const { data } = await api.get(`/tailored-resumes/${encodeURIComponent(id)}/pdf`, { responseType: 'blob', timeout: 60_000, signal });
  return data;
}

export async function fetchTailoredPdfDownloadUrl(id) {
  const { data } = await api.get(`/tailored-resumes/${encodeURIComponent(id)}/pdf/download-url`);
  return data.data;
}
