import { Router } from 'express';
import { createController } from '../controllers/jobApplication.controller.js';
import { describeLinks, resolveLinks, setLinks } from '../services/job-application-links.service.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import {
  cancelInterviewSchema,
  createApplicationSchema,
  createFollowUpSchema,
  createInterviewSchema,
  linksSchema,
  rescheduleSchema,
  revisionSchema,
  statusChangeSchema,
  updateApplicationSchema,
  updateFollowUpSchema,
  updateInterviewSchema,
} from '../validators/job-application.schema.js';

// Every route requires sign-in; every lookup is scoped to req.user.id in the service layer.
const router = Router();
router.use(requireAuth);

const c = createController({ resolveLinks, describeLinks, setLinks });

router.post('/', validateBody(createApplicationSchema), c.create);
router.get('/', c.list);
router.get('/dashboard', c.dashboard); // fixed paths before '/:id'
router.get('/board', c.board);
router.get('/export.csv', c.exportCsv);
router.get('/:id', c.get);
router.patch('/:id', validateBody(updateApplicationSchema), c.update);
router.delete('/:id', c.remove);
router.post('/:id/status', validateBody(statusChangeSchema), c.status);
router.post('/:id/status/undo', validateBody(revisionSchema), c.undo);
router.put('/:id/links', validateBody(linksSchema), c.links);
router.post('/:id/interviews', validateBody(createInterviewSchema), c.addInterview);
router.patch('/:id/interviews/:interviewId', validateBody(updateInterviewSchema), c.updateInterview);
router.post('/:id/interviews/:interviewId/reschedule', validateBody(rescheduleSchema), c.rescheduleInterview);
router.post('/:id/interviews/:interviewId/cancel', validateBody(cancelInterviewSchema), c.cancelInterview);
router.post('/:id/follow-ups', validateBody(createFollowUpSchema), c.addFollowUp);
router.patch('/:id/follow-ups/:followUpId', validateBody(updateFollowUpSchema), c.updateFollowUp);
router.delete('/:id/follow-ups/:followUpId', validateBody(revisionSchema), c.deleteFollowUp);

export default router;
