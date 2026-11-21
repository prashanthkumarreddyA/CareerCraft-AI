import { Router } from 'express';
import {
  uploadMaster,
  replaceMaster,
  getMaster,
  deleteMaster,
  streamMasterFile,
  getMasterDownloadUrl,
  streamMasterBackup,
  getMasterBackupUrl,
} from '../controllers/masterResume.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { uploadLimiter } from '../middleware/rateLimiter.js';
import { uploadResumePdf } from '../middleware/upload.js';

// Every route is scoped to the signed-in user (req.user.id); there is no way to address
// another user's resume. Tailored versions live under /api/tailored-resumes.
const router = Router();
router.use(requireAuth);

router.post('/upload', uploadLimiter, uploadResumePdf, uploadMaster);
router.get('/master', getMaster);
router.put('/master', uploadLimiter, uploadResumePdf, replaceMaster);
router.delete('/master', deleteMaster);
router.get('/master/file', streamMasterFile);
router.get('/master/download-url', getMasterDownloadUrl);
router.get('/master/backups/:backupId/file', streamMasterBackup);
router.get('/master/backups/:backupId/download-url', getMasterBackupUrl);

export default router;
