import { Router } from 'express';
import { requireDatabase } from '../middleware/requireDatabase.js';
import authRoutes from './auth.routes.js';
import resumeRoutes from './resume.routes.js';
import jobAnalysisRoutes from './job-analysis.routes.js';
import tailoredResumeRoutes from './tailored-resume.routes.js';
import jobApplicationRoutes from './job-application.routes.js';

const router = Router();

router.use('/auth', requireDatabase, authRoutes);
router.use('/resumes', requireDatabase, resumeRoutes);
router.use('/job-analysis', requireDatabase, jobAnalysisRoutes);
router.use('/tailored-resumes', requireDatabase, tailoredResumeRoutes);
router.use('/applications', requireDatabase, jobApplicationRoutes);

export default router;
