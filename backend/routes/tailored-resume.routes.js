import { Router } from 'express';
import { acceptAll, approve, createPdf, decide, duplicate, getVersion, listAll, pdfDownloadUrl, remove, streamPdf } from '../controllers/tailoredResume.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { uploadLimiter } from '../middleware/rateLimiter.js';
import { validateBody } from '../middleware/validate.js';
import { decisionSchema, revisionSchema } from '../validators/tailored-resume.schema.js';

// All routes require sign-in; the service scopes every lookup to req.user.id.
const router = Router();
router.use(requireAuth);

router.get('/', listAll);
router.get('/:id', getVersion);
router.patch('/:id/changes/:changeId', validateBody(decisionSchema), decide);
router.post('/:id/accept-all', validateBody(revisionSchema), acceptAll);
router.post('/:id/approve', validateBody(revisionSchema), approve);
router.post('/:id/duplicate', duplicate);
router.delete('/:id', remove);
router.post('/:id/pdf', uploadLimiter, createPdf);
router.get('/:id/pdf', streamPdf);
router.get('/:id/pdf/download-url', pdfDownloadUrl);

export default router;
