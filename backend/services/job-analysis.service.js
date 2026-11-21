import mongoose from 'mongoose';
import { JobAnalysis } from '../models/JobAnalysis.js';
import { MasterResume } from '../models/MasterResume.js';
import { TailoredResume } from '../models/TailoredResume.js';
import { ApiError } from '../utils/ApiError.js';
import { assertNotLinkedToApplication } from './application-links-guard.js';
import { analyzeJobDescription, ANALYSIS_VERSION } from './job-analysis/analyze-job.js';

/**
 * Job analysis persistence. Every query is scoped by userId, so one user can never read or
 * delete another user's analysis (unknown and foreign ids both return 404).
 * The master resume is only read here, never modified.
 */

const notFound = () => ApiError.notFound('Job analysis not found.', { code: 'JOB_ANALYSIS_NOT_FOUND' });

/** Hash of the user's current master resume file (undefined when there is none). */
export async function currentMasterHash(userId) {
  return (await MasterResume.findOne({ userId }).select('fileHash').lean())?.fileHash;
}

/** An analysis is stale when the master resume was replaced or deleted after it was made. */
export const isStale = (o, masterHash) => !masterHash || o.sourceResume?.fileHash !== masterHash;

export function toPublicJobAnalysis(doc, { currentMasterHash: masterHash } = {}) {
  const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    id: String(o._id),
    companyName: o.companyName,
    jobTitle: o.jobTitle,
    jobDescription: o.jobDescription,
    jobAnalysis: o.jobAnalysis,
    keywordAnalysis: o.keywordAnalysis,
    matchAnalysis: o.matchAnalysis,
    matchPercentage: o.matchPercentage,
    analysisVersion: o.analysisVersion,
    sourceResume: { fileHash: o.sourceResume?.fileHash },
    stale: isStale(o, masterHash),
    ai: { provider: o.ai?.provider, model: o.ai?.model },
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

function toSummary(o, masterHash) {
  const score = o.matchAnalysis?.score ?? {};
  return {
    id: String(o._id),
    companyName: o.companyName,
    jobTitle: o.jobTitle,
    matchPercentage: o.matchPercentage,
    totalRequirements: score.totalRequirements,
    matchedRequirements: score.matchedRequirements,
    partiallySupportedRequirements: score.partiallySupportedRequirements,
    missingRequirements: score.missingRequirements,
    mustHaveCoverage: score.mustHaveCoverage,
    analysisVersion: o.analysisVersion,
    stale: isStale(o, masterHash),
    createdAt: o.createdAt,
  };
}

export async function createJobAnalysis(userId, { companyName, jobTitle, jobDescription }, ai) {
  if (!ai?.isConfigured) {
    throw ApiError.serviceUnavailable('AI analysis is not configured on the server.', { code: 'AI_NOT_CONFIGURED' });
  }
  const master = await MasterResume.findOne({ userId }).select('structuredResumeData fileHash extractorVersion').lean();
  if (!master) {
    throw ApiError.unprocessable('Upload your master resume before analysing a job description.', { code: 'MASTER_RESUME_REQUIRED' });
  }

  const result = await analyzeJobDescription({ jobTitle, jobDescription, resume: master.structuredResumeData, ai });

  const doc = await JobAnalysis.create({
    userId,
    companyName,
    jobTitle,
    jobDescription,
    jobAnalysis: result.jobAnalysis,
    keywordAnalysis: result.keywordAnalysis,
    matchAnalysis: result.matchAnalysis,
    matchPercentage: result.matchPercentage,
    analysisVersion: ANALYSIS_VERSION,
    sourceResume: { masterResumeId: master._id, fileHash: master.fileHash, extractorVersion: master.extractorVersion },
    ai: result.ai,
  });
  return toPublicJobAnalysis(doc, { currentMasterHash: master.fileHash });
}

export async function listJobAnalyses(userId, { page, limit }) {
  const filter = { userId };
  const [items, total] = await Promise.all([
    JobAnalysis.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('companyName jobTitle matchPercentage analysisVersion createdAt matchAnalysis.score sourceResume.fileHash')
      .lean(),
    JobAnalysis.countDocuments(filter),
  ]);
  const masterHash = await currentMasterHash(userId);
  return { items: items.map((o) => toSummary(o, masterHash)), page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

export async function getJobAnalysis(userId, id) {
  if (!mongoose.isValidObjectId(id)) throw notFound();
  const doc = await JobAnalysis.findOne({ _id: id, userId }).lean();
  if (!doc) throw notFound();
  return toPublicJobAnalysis(doc, { currentMasterHash: await currentMasterHash(userId) });
}

export async function deleteJobAnalysis(userId, id) {
  if (!mongoose.isValidObjectId(id)) throw notFound();
  if (await TailoredResume.exists({ userId, jobAnalysisId: id })) {
    throw ApiError.conflict('Delete the tailored resumes created from this analysis first.', { code: 'JOB_ANALYSIS_HAS_VERSIONS' });
  }
  await assertNotLinkedToApplication(userId, { jobAnalysisId: id });
  const { deletedCount } = await JobAnalysis.deleteOne({ _id: id, userId });
  if (!deletedCount) throw notFound();
}
