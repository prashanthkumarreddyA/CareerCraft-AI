import { Router } from 'express';
import { createAnalysis, deleteAnalysis, getAnalysis, listAnalyses } from '../controllers/jobAnalysis.controller.js';
import { createVersion, listForAnalysis } from '../controllers/tailoredResume.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { aiLimiter } from '../middleware/rateLimiter.js';
import { validateBody } from '../middleware/validate.js';
import { createJobAnalysisSchema } from '../validators/job-analysis.schema.js';

// All routes require sign-in; every lookup is scoped to req.user.id in the service layer.
const router = Router();
router.use(requireAuth);

router.post('/', aiLimiter, validateBody(createJobAnalysisSchema), createAnalysis);
router.get('/', listAnalyses);
router.get('/:id', getAnalysis);
router.delete('/:id', deleteAnalysis);
router.post('/:id/tailored-resumes', aiLimiter, createVersion);
router.get('/:id/tailored-resumes', listForAnalysis);

export default router;
