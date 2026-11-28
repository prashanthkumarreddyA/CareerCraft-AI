import {
  createMasterResume,
  replaceMasterResume,
  upsertMasterProfile,
  deleteMasterResume,
  getMasterResume,
  getMasterResumeFile,
  getMasterResumeDownloadUrl,
  getMasterBackupFile,
  getMasterBackupDownloadUrl,
} from '../services/master-resume.service.js';

const storageOf = (req) => req.app.locals.storage;
const aiOf = (req) => req.app.locals.ai;

export async function uploadMaster(req, res) {
  const masterResume = await createMasterResume(req.user.id, req.file, storageOf(req), aiOf(req));
  res.status(201).json({ success: true, data: { masterResume } });
}

export async function replaceMaster(req, res) {
  const masterResume = await replaceMasterResume(req.user.id, req.file, storageOf(req), aiOf(req));
  res.json({ success: true, data: { masterResume } });
}

export async function saveMasterProfile(req, res) {
  const masterResume = await upsertMasterProfile(req.user.id, req.body);
  res.json({ success: true, data: { masterResume } });
}

export async function getMaster(req, res) {
  const masterResume = await getMasterResume(req.user.id, { includeLines: req.query.include === 'lines' });
  res.json({ success: true, data: { masterResume } });
}

export async function deleteMaster(req, res) {
  await deleteMasterResume(req.user.id, storageOf(req));
  res.json({ success: true, data: { deleted: true } });
}

/** Streams the original PDF to its owner for in-app preview. */
export async function streamMasterFile(req, res) {
  const { buffer } = await getMasterResumeFile(req.user.id, storageOf(req));
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Length': String(buffer.length),
    'Content-Disposition': 'inline; filename="master-resume.pdf"',
    'Cache-Control': 'private, no-store',
  });
  res.send(buffer);
}

/** Short-lived signed Cloudinary link for downloading the original PDF. */
export async function getMasterDownloadUrl(req, res) {
  const link = await getMasterResumeDownloadUrl(req.user.id, storageOf(req));
  res.set('Cache-Control', 'no-store').json({ success: true, data: link });
}

/** Streams a previous master resume PDF (kept as a backup on replace) to its owner. */
export async function streamMasterBackup(req, res) {
  const { buffer } = await getMasterBackupFile(req.user.id, req.params.backupId, storageOf(req));
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Length': String(buffer.length),
    'Content-Disposition': 'inline; filename="master-resume-backup.pdf"',
    'Cache-Control': 'private, no-store',
  });
  res.send(buffer);
}

export async function getMasterBackupUrl(req, res) {
  const link = await getMasterBackupDownloadUrl(req.user.id, req.params.backupId, storageOf(req));
  res.set('Cache-Control', 'no-store').json({ success: true, data: link });
}
