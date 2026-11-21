import { api } from './api';

/** The browser's IANA time zone: "today", overdue follow-ups and trends use the user's calendar. */
export const userTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

const base = '/applications';
const path = (id, rest = '') => `${base}/${encodeURIComponent(id)}${rest}`;
const withTz = (params = {}) => ({ params: { ...params, tz: userTimeZone() } });
const app = (res) => res.data.data.application;

/** Filters → query params (status as a comma list; empty values dropped). */
export function toParams(filters = {}) {
  const out = {};
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    out[k] = Array.isArray(v) ? v.join(',') : v;
  }
  return out;
}

export async function listApplications(filters) {
  return (await api.get(base, withTz(toParams(filters)))).data.data;
}
export async function fetchBoard() {
  return (await api.get(`${base}/board`, withTz())).data.data;
}
export async function fetchDashboard() {
  return (await api.get(`${base}/dashboard`, withTz())).data.data.dashboard;
}
export async function fetchApplication(id) {
  return app(await api.get(path(id), withTz()));
}
export async function createApplication(body) {
  return app(await api.post(base, body, withTz()));
}
export async function updateApplication(id, body) {
  return app(await api.patch(path(id), body, withTz()));
}
export async function deleteApplication(id) {
  await api.delete(path(id));
}
export async function changeStatus(id, status, expectedRevision, note) {
  return app(await api.post(path(id, '/status'), { status, expectedRevision, ...(note ? { note } : {}) }, withTz()));
}
export async function undoStatus(id, expectedRevision) {
  return app(await api.post(path(id, '/status/undo'), { expectedRevision }, withTz()));
}
export async function setLinks(id, { jobAnalysisId, tailoredResumeId }, expectedRevision) {
  return app(await api.put(path(id, '/links'), { jobAnalysisId, tailoredResumeId, expectedRevision }, withTz()));
}
export async function addInterview(id, body) {
  return app(await api.post(path(id, '/interviews'), body, withTz()));
}
export async function updateInterview(id, interviewId, body) {
  return app(await api.patch(path(id, `/interviews/${encodeURIComponent(interviewId)}`), body, withTz()));
}
export async function rescheduleInterview(id, interviewId, body) {
  return app(await api.post(path(id, `/interviews/${encodeURIComponent(interviewId)}/reschedule`), body, withTz()));
}
export async function cancelInterview(id, interviewId, body) {
  return app(await api.post(path(id, `/interviews/${encodeURIComponent(interviewId)}/cancel`), body, withTz()));
}
export async function addFollowUp(id, body) {
  return app(await api.post(path(id, '/follow-ups'), body, withTz()));
}
export async function updateFollowUp(id, followUpId, body) {
  return app(await api.patch(path(id, `/follow-ups/${encodeURIComponent(followUpId)}`), body, withTz()));
}
export async function deleteFollowUp(id, followUpId, expectedRevision) {
  return app(await api.delete(path(id, `/follow-ups/${encodeURIComponent(followUpId)}`), { data: { expectedRevision }, ...withTz() }));
}

/** Downloads the CSV export (authenticated request → Blob → file save). */
export async function downloadCsv(filters) {
  const res = await api.get(`${base}/export.csv`, { ...withTz(toParams({ ...filters, page: undefined, limit: undefined })), responseType: 'blob', timeout: 60_000 });
  const name = /filename="([^"]+)"/.exec(res.headers['content-disposition'] ?? '')?.[1] ?? 'job-applications.csv';
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
