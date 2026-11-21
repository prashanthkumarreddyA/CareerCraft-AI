import { JobAnalysis } from '../models/JobAnalysis.js';
import { TailoredResume } from '../models/TailoredResume.js';
import { JobApplication } from '../models/JobApplication.js';
import { ApiError } from '../utils/ApiError.js';
import { currentMasterHash } from './job-analysis.service.js';
import { findOwned, isId, LIMITS, updateOwned } from './job-application.service.js';

/**
 * Links between a job application and the user's existing JobAnalysis / TailoredResume records
 * (checkpoint 6C). Only references are stored, never copies. A linked version must be approved
 * or have its PDF (decision 6-2) and belong to the linked analysis. The PDF itself is served by
 * the existing owner-checked tailored-resume endpoints; this module never touches storage.
 */

const LINKABLE = new Set(['approved', 'pdf_ready']);

const analysisNotFound = () => ApiError.notFound('Job analysis not found.', { code: 'JOB_ANALYSIS_NOT_FOUND' });
const versionNotFound = () => ApiError.notFound('Tailored resume not found.', { code: 'TAILORED_RESUME_NOT_FOUND' });

/**
 * Validates requested links for this user. The analysis may be omitted when a version is given
 * (it is taken from the version). Returns { jobAnalysisId, tailoredResumeId, analysis, version }.
 */
export async function resolveLinks(userId, { jobAnalysisId = null, tailoredResumeId = null }) {
  let version = null;
  if (tailoredResumeId) {
    if (!isId(tailoredResumeId)) throw versionNotFound();
    version = await TailoredResume.findOne({ _id: tailoredResumeId, userId }).select('jobAnalysisId versionNumber status').lean();
    if (!version) throw versionNotFound();
    if (!LINKABLE.has(version.status)) {
      throw ApiError.unprocessable('Only approved tailored resumes (or ones with a PDF) can be linked to an application.', { code: 'VERSION_NOT_APPROVED' });
    }
    if (jobAnalysisId && String(version.jobAnalysisId) !== String(jobAnalysisId)) {
      throw ApiError.unprocessable('This tailored resume was created from a different job analysis.', { code: 'LINK_MISMATCH' });
    }
    jobAnalysisId ??= String(version.jobAnalysisId);
  }
  let analysis = null;
  if (jobAnalysisId) {
    if (!isId(jobAnalysisId)) throw analysisNotFound();
    analysis = await JobAnalysis.findOne({ _id: jobAnalysisId, userId }).select('companyName jobTitle jobDescription').lean();
    if (!analysis) throw analysisNotFound();
  }
  return { jobAnalysisId: analysis?._id ?? null, tailoredResumeId: version?._id ?? null, analysis, version };
}

/** Summaries of the linked records for display (no storage ids, no content). */
export async function describeLinks(userId, doc) {
  if (!doc.jobAnalysisId && !doc.tailoredResumeId) return { jobAnalysis: null, tailoredResume: null };
  const [analysis, version, masterHash] = await Promise.all([
    doc.jobAnalysisId ? JobAnalysis.findOne({ _id: doc.jobAnalysisId, userId }).select('companyName jobTitle matchPercentage createdAt sourceResume.fileHash').lean() : null,
    doc.tailoredResumeId ? TailoredResume.findOne({ _id: doc.tailoredResumeId, userId }).select('versionNumber status approvedAt pdf.fileHash pdf.pageCount pdf.generatedAt sourceResumeHash').lean() : null,
    currentMasterHash(userId),
  ]);
  return {
    jobAnalysis: doc.jobAnalysisId
      ? analysis
        ? { id: String(analysis._id), companyName: analysis.companyName, jobTitle: analysis.jobTitle, matchPercentage: analysis.matchPercentage, createdAt: analysis.createdAt, stale: analysis.sourceResume?.fileHash !== masterHash }
        : { id: String(doc.jobAnalysisId), missing: true }
      : null,
    tailoredResume: doc.tailoredResumeId
      ? version
        ? { id: String(version._id), versionNumber: version.versionNumber, status: version.status, approvedAt: version.approvedAt, hasPdf: Boolean(version.pdf?.fileHash), pdfPageCount: version.pdf?.pageCount ?? null, masterChanged: version.sourceResumeHash !== masterHash }
        : { id: String(doc.tailoredResumeId), missing: true }
      : null,
  };
}

/**
 * Sets or clears the links. The previous link is appended to `linkHistory` (with its version
 * number, so history stays readable). After the write, the referenced records are re-checked:
 * if one was deleted concurrently, the change is rolled back.
 */
export async function setLinks(userId, id, { jobAnalysisId, tailoredResumeId, expectedRevision }, { now = new Date() } = {}) {
  const doc = await findOwned(userId, id);
  if (doc.revision !== expectedRevision) throw ApiError.conflict('This application was changed elsewhere. Reload to see the latest version.', { code: 'REVISION_CONFLICT' });
  const next = await resolveLinks(userId, { jobAnalysisId, tailoredResumeId });
  const same = String(next.jobAnalysisId ?? '') === String(doc.jobAnalysisId ?? '') && String(next.tailoredResumeId ?? '') === String(doc.tailoredResumeId ?? '');
  if (same) return doc;

  const update = { $set: { jobAnalysisId: next.jobAnalysisId, tailoredResumeId: next.tailoredResumeId, linkedAt: next.jobAnalysisId || next.tailoredResumeId ? now : null } };
  if (doc.jobAnalysisId || doc.tailoredResumeId) {
    if ((doc.linkHistory?.length ?? 0) >= LIMITS.linkHistory) throw ApiError.unprocessable('This application has reached the maximum number of link changes.', { code: 'LIMIT_REACHED' });
    const previousVersion = doc.tailoredResumeId ? await TailoredResume.findOne({ _id: doc.tailoredResumeId, userId }).select('versionNumber').lean() : null;
    update.$push = {
      linkHistory: { jobAnalysisId: doc.jobAnalysisId, tailoredResumeId: doc.tailoredResumeId, versionNumber: previousVersion?.versionNumber ?? null, linkedAt: doc.linkedAt ?? doc.createdAt, unlinkedAt: now },
    };
  }
  const updated = await updateOwned(userId, id, expectedRevision, update);

  // Safe rollback: a concurrent delete of a referenced record must not leave a dangling link.
  const stillThere = await Promise.all([
    next.jobAnalysisId ? JobAnalysis.exists({ _id: next.jobAnalysisId, userId }) : true,
    next.tailoredResumeId ? TailoredResume.exists({ _id: next.tailoredResumeId, userId }) : true,
  ]);
  if (!stillThere.every(Boolean)) {
    await JobApplication.updateOne(
      { _id: updated._id, userId, revision: updated.revision },
      { $set: { jobAnalysisId: doc.jobAnalysisId, tailoredResumeId: doc.tailoredResumeId, linkedAt: doc.linkedAt, linkHistory: doc.linkHistory }, $inc: { revision: 1 } },
    );
    throw ApiError.conflict('A linked record was deleted while linking. Nothing was changed.', { code: 'LINK_TARGET_DELETED' });
  }
  return updated;
}
