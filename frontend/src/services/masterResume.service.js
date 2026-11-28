import { api } from './api';

const UPLOAD_TIMEOUT_MS = 120_000; // covers a cold-starting server plus extraction

/** Resolves the master resume, or null if none has been uploaded yet. */
export async function fetchMasterResume() {
  try {
    const { data } = await api.get('/resumes/master');
    return data.data.masterResume;
  } catch (err) {
    if (err.status === 404 && err.code === 'MASTER_RESUME_NOT_FOUND') return null;
    throw err;
  }
}

/** Uploads (mode "create") or replaces (mode "replace") the master resume PDF. */
export async function uploadMasterResume(file, { mode = 'create', onProgress, signal } = {}) {
  const form = new FormData();
  form.append('resume', file);
  const request = mode === 'replace' ? api.put : api.post;
  const url = mode === 'replace' ? '/resumes/master' : '/resumes/upload';
  const { data } = await request(url, form, {
    timeout: UPLOAD_TIMEOUT_MS,
    signal,
    onUploadProgress: (e) => onProgress?.(e.total ? Math.round((e.loaded / e.total) * 100) : null),
  });
  return data.data.masterResume;
}

export async function deleteMasterResume() {
  await api.delete('/resumes/master');
}

/** Creates or updates the user's structured profile manually. */
export async function saveMasterProfile(profileData) {
  const { data } = await api.put('/resumes/master/profile', profileData);
  return data.data.masterResume;
}

/** Original PDF as a Blob (streamed by the backend for the owner only). */
export async function fetchMasterResumePdf({ signal } = {}) {
  const { data } = await api.get('/resumes/master/file', { responseType: 'blob', timeout: 60_000, signal });
  return data;
}

/** Short-lived signed download link: { url, expiresAt }. */
export async function fetchMasterResumeDownloadUrl() {
  const { data } = await api.get('/resumes/master/download-url');
  return data.data;
}

/** Short-lived signed download link for a previous master resume (kept as a backup on replace). */
export async function fetchMasterBackupDownloadUrl(backupId) {
  const { data } = await api.get(`/resumes/master/backups/${encodeURIComponent(backupId)}/download-url`);
  return data.data;
}
