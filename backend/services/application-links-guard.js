import { JobApplication } from '../models/JobApplication.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Blocks deleting a job analysis or tailored resume that a job application references, now or in
 * its link history (decision 6-1: preserve application history). Scoped to the same user.
 */
export async function assertNotLinkedToApplication(userId, { jobAnalysisId, tailoredResumeId }) {
  const field = jobAnalysisId ? 'jobAnalysisId' : 'tailoredResumeId';
  const id = jobAnalysisId ?? tailoredResumeId;
  const linked = await JobApplication.exists({ userId, $or: [{ [field]: id }, { [`linkHistory.${field}`]: id }] });
  if (linked) {
    const what = jobAnalysisId ? 'analysis' : 'tailored resume';
    throw ApiError.conflict(`This ${what} is linked to a job application (now or in its history), so it cannot be deleted.`, { code: 'LINKED_TO_APPLICATION' });
  }
}
