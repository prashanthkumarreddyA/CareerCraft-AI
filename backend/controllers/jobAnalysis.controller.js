import { createJobAnalysis, deleteJobAnalysis, getJobAnalysis, listJobAnalyses } from '../services/job-analysis.service.js';
import { listJobAnalysesQuerySchema } from '../validators/job-analysis.schema.js';

const aiOf = (req) => req.app.locals.ai;

export async function createAnalysis(req, res) {
  const jobAnalysis = await createJobAnalysis(req.user.id, req.body, aiOf(req));
  res.status(201).json({ success: true, data: { jobAnalysis } });
}

export async function listAnalyses(req, res) {
  const query = listJobAnalysesQuerySchema.parse(req.query ?? {});
  res.json({ success: true, data: await listJobAnalyses(req.user.id, query) });
}

export async function getAnalysis(req, res) {
  res.json({ success: true, data: { jobAnalysis: await getJobAnalysis(req.user.id, req.params.id) } });
}

export async function deleteAnalysis(req, res) {
  await deleteJobAnalysis(req.user.id, req.params.id);
  res.json({ success: true, data: { deleted: true } });
}
