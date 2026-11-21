import mongoose from 'mongoose';
import { TailoredResume } from '../models/TailoredResume.js';
import { JobAnalysis } from '../models/JobAnalysis.js';
import { MasterResume } from '../models/MasterResume.js';
import { ApiError } from '../utils/ApiError.js';
import { assertNotLinkedToApplication } from './application-links-guard.js';
import { buildFactSheet } from './tailoring/fact-sheet.js';
import { checkClaim, evidenceScope, normalizeText } from './tailoring/claim-checker.js';
import { buildContent, contentHash, effectiveText, keywordCoverage, layoutReport, rewordedPairs, validOrder, verifyLockedFields } from './tailoring/content-builder.js';
import { generateTailoringProposals, GENERATOR_VERSION } from './tailoring/generate-proposals.js';
import { allResumeText, unsupportedCharacters } from './tailoring/resume-renderer.js';

/**
 * Tailored resume workflow. Every query is scoped by userId (foreign ids → 404).
 * The master resume and the job analysis are only read.
 */

const notFound = () => ApiError.notFound('Tailored resume not found.', { code: 'TAILORED_RESUME_NOT_FOUND' });
const TEXT_TYPES = new Set(['summary', 'bullet']);
// Problems an override cannot waive: they would break the document itself, or change the locked
// professional identity.
const NOT_OVERRIDABLE = new Set(['EMPTY_TEXT', 'TEXT_TOO_LONG', 'MULTILINE', 'UNSUPPORTED_CHARACTER', 'IDENTITY_CHANGED', 'GAP_KEYWORD']);
const errorsOf = (validation) => (validation?.issues ?? []).filter((i) => i.severity === 'error');
// Possible changes of meaning: never accepted without the user's explicit, recorded review.
const reviewsOf = (validation) => (validation?.issues ?? []).filter((i) => i.severity === 'review');

function factsFor(doc) {
  return buildFactSheet(doc.baseContent, { matchAnalysis: doc.analysisSnapshot });
}

/** Claim check of an AI proposal with the CURRENT rules (stored results may predate a rule). */
function checkProposal(change, facts) {
  return checkClaim({ text: change.proposed, original: change.original, target: change.target, evidenceIds: change.evidenceIds, author: 'ai' }, facts);
}

/** Draft changes with their proposal validation refreshed to the current rules. */
function withCurrentValidation(changes, facts) {
  return changes.map((c) => (TEXT_TYPES.has(c.type) ? { ...c, validation: checkProposal(c, facts) } : c));
}

function decisionCounts(changes) {
  const counts = { total: changes.length, pending: 0, accepted: 0, rejected: 0, edited: 0, overrides: 0, reviewed: 0 };
  for (const c of changes) {
    counts[c.decision] += 1;
    if (c.decision === 'edited' && c.override?.confirmed) counts.overrides += 1;
    if (['accepted', 'edited'].includes(c.decision) && c.review?.confirmed) counts.reviewed += 1;
  }
  return counts;
}

export function toPublicTailoredResume(doc, { currentMasterHash } = {}) {
  const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  if (o.status === 'draft') o.changes = withCurrentValidation(o.changes, factsFor(o));
  const content = o.finalContent ?? buildContent(o.baseContent, o.changes);
  return {
    id: String(o._id),
    jobAnalysisId: String(o.jobAnalysisId),
    versionNumber: o.versionNumber,
    status: o.status,
    revision: o.revision,
    companyName: o.companyName,
    jobTitle: o.jobTitle,
    changes: o.changes,
    blocked: o.blocked,
    gaps: o.gaps,
    progress: decisionCounts(o.changes),
    baseContent: o.baseContent,
    content,
    contentHash: o.contentHash,
    coverage: keywordCoverage(o.baseContent, content, o.analysisSnapshot.requirements),
    layout: o.validationReport?.layout ?? layoutReport(o.baseContent, content, rewordedPairs(o.changes)),
    validationReport: o.validationReport,
    pdf: o.pdf?.fileHash ? { fileHash: o.pdf.fileHash, fileSize: o.pdf.fileSize, pageCount: o.pdf.pageCount, templateId: o.pdf.templateId, generatedAt: o.pdf.generatedAt, validation: o.pdf.validation } : null,
    copiedFrom: o.copiedFrom?.versionNumber ? { versionNumber: o.copiedFrom.versionNumber, id: String(o.copiedFrom.tailoredResumeId) } : null,
    masterChanged: currentMasterHash ? currentMasterHash !== o.sourceResumeHash : undefined,
    ai: { provider: o.ai?.provider, model: o.ai?.model, repairRound: o.ai?.repairRound },
    approvedAt: o.approvedAt,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

const toSummary = (o, masterHash) => ({
  id: String(o._id),
  jobAnalysisId: String(o.jobAnalysisId),
  versionNumber: o.versionNumber,
  status: o.status,
  companyName: o.companyName,
  jobTitle: o.jobTitle,
  progress: decisionCounts(o.changes ?? []),
  hasPdf: Boolean(o.pdf?.fileHash),
  masterChanged: masterHash !== o.sourceResumeHash,
  approvedAt: o.approvedAt,
  createdAt: o.createdAt,
});

async function findOwned(userId, id) {
  if (!mongoose.isValidObjectId(id)) throw notFound();
  const doc = await TailoredResume.findOne({ _id: id, userId }).lean();
  if (!doc) throw notFound();
  return doc;
}

async function currentMasterHash(userId) {
  return (await MasterResume.findOne({ userId }).select('fileHash').lean())?.fileHash;
}

/**
 * A version built from an older master resume must not be approved, printed or copied: its facts
 * may include skills the user has since removed. It stays readable (history), and any PDF already
 * generated stays downloadable.
 */
export async function assertMasterCurrent(userId, doc) {
  if ((await currentMasterHash(userId)) !== doc.sourceResumeHash) {
    throw ApiError.conflict('Your master resume changed after this version was created. Run a new analysis and create a new version.', { code: 'MASTER_CHANGED' });
  }
}

async function nextVersionNumber(userId, jobAnalysisId) {
  const last = await TailoredResume.findOne({ userId, jobAnalysisId }).sort({ versionNumber: -1 }).select('versionNumber').lean();
  return (last?.versionNumber ?? 0) + 1;
}

/** Inserts with the next version number; retries once if a concurrent request took it. */
async function insertVersion(userId, jobAnalysisId, data) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await TailoredResume.create({ ...data, userId, jobAnalysisId, versionNumber: await nextVersionNumber(userId, jobAnalysisId) });
    } catch (err) {
      if (err.code !== 11000 || attempt === 2) throw err;
    }
  }
  throw new Error('unreachable');
}

export async function createTailoredResume(userId, jobAnalysisId, ai) {
  if (!mongoose.isValidObjectId(jobAnalysisId)) throw ApiError.notFound('Job analysis not found.', { code: 'JOB_ANALYSIS_NOT_FOUND' });
  const analysis = await JobAnalysis.findOne({ _id: jobAnalysisId, userId }).lean();
  if (!analysis) throw ApiError.notFound('Job analysis not found.', { code: 'JOB_ANALYSIS_NOT_FOUND' });
  const master = await MasterResume.findOne({ userId }).select('structuredResumeData fileHash').lean();
  if (!master) throw ApiError.unprocessable('Upload your master resume first.', { code: 'MASTER_RESUME_REQUIRED' });
  if (master.fileHash !== analysis.sourceResume?.fileHash) {
    throw ApiError.conflict('Your master resume changed after this analysis. Run a new analysis first so the evidence matches.', { code: 'ANALYSIS_STALE' });
  }
  if (!ai?.isConfigured) throw ApiError.serviceUnavailable('AI analysis is not configured on the server.', { code: 'AI_NOT_CONFIGURED' });

  const analysisSnapshot = { requirements: analysis.matchAnalysis.requirements, responsibilities: analysis.matchAnalysis.responsibilities ?? [] };
  const generated = await generateTailoringProposals({ resume: master.structuredResumeData, analysis: { jobTitle: analysis.jobTitle, matchAnalysis: analysisSnapshot }, ai });
  const now = new Date();
  const doc = await insertVersion(userId, analysis._id, {
    masterResumeId: master._id,
    sourceResumeHash: master.fileHash,
    companyName: analysis.companyName,
    jobTitle: analysis.jobTitle,
    baseContent: master.structuredResumeData,
    analysisSnapshot,
    changes: generated.changes.map((c) => ({ ...c, decision: 'pending', editedText: null, editValidation: null, override: null, history: [{ at: now, action: 'proposed', by: c.type === 'summary' || c.type === 'bullet' ? 'ai' : 'rules' }] })),
    blocked: generated.blocked,
    gaps: generated.gaps,
    ai: generated.ai,
    generatorVersion: GENERATOR_VERSION,
  });
  return toPublicTailoredResume(doc, { currentMasterHash: master.fileHash });
}

export async function listTailoredResumes(userId, { jobAnalysisId } = {}) {
  const filter = { userId };
  if (jobAnalysisId) {
    if (!mongoose.isValidObjectId(jobAnalysisId)) return { items: [] };
    filter.jobAnalysisId = jobAnalysisId;
  }
  const docs = await TailoredResume.find(filter).sort({ createdAt: -1, _id: -1 }).limit(200).select('jobAnalysisId versionNumber status companyName jobTitle changes.decision changes.override pdf.fileHash approvedAt createdAt sourceResumeHash').lean();
  const masterHash = await currentMasterHash(userId);
  return { items: docs.map((o) => toSummary(o, masterHash)) };
}

export async function getTailoredResume(userId, id) {
  return toPublicTailoredResume(await findOwned(userId, id), { currentMasterHash: await currentMasterHash(userId) });
}

/** Saves new `changes` only if nobody else changed the version meanwhile and it is still a draft. */
async function saveChanges(userId, doc, changes, expectedRevision) {
  const result = await TailoredResume.updateOne({ _id: doc._id, userId, revision: expectedRevision, status: 'draft' }, { $set: { changes }, $inc: { revision: 1 } });
  if (!result.matchedCount) {
    const fresh = await TailoredResume.findOne({ _id: doc._id, userId }).select('status').lean();
    if (fresh && fresh.status !== 'draft') throw ApiError.conflict('This version is approved and can no longer be edited. Duplicate it to make changes.', { code: 'VERSION_LOCKED' });
    throw ApiError.conflict('This version was changed elsewhere. Reload to see the latest decisions.', { code: 'REVISION_CONFLICT' });
  }
  return getTailoredResume(userId, doc._id);
}

function assertEditable(doc, expectedRevision) {
  if (doc.status !== 'draft') throw ApiError.conflict('This version is approved and can no longer be edited. Duplicate it to make changes.', { code: 'VERSION_LOCKED' });
  if (doc.revision !== expectedRevision) throw ApiError.conflict('This version was changed elsewhere. Reload to see the latest decisions.', { code: 'REVISION_CONFLICT' });
}

/** Checks the user's own wording for a summary/bullet change (whole allowed scope as evidence). */
export function checkUserEdit(change, text, facts) {
  return checkClaim({ text, original: change.original, target: change.target, evidenceIds: evidenceScope(change.target, facts), author: 'user' }, facts);
}

export async function decideChange(userId, id, changeId, { decision, text, confirmOverride = false, confirmReview = false, expectedRevision }) {
  const doc = await findOwned(userId, id);
  assertEditable(doc, expectedRevision);
  const index = doc.changes.findIndex((c) => c.changeId === changeId);
  if (index === -1) throw ApiError.notFound('Change not found.', { code: 'CHANGE_NOT_FOUND' });
  const change = { ...doc.changes[index], history: [...(doc.changes[index].history ?? [])] };
  const at = new Date();

  if (decision === 'accept') {
    if (TEXT_TYPES.has(change.type)) change.validation = checkProposal(change, factsFor(doc));
    if (!change.validation?.passed || !validOrder(change, doc.baseContent)) throw ApiError.unprocessable('This proposal did not pass validation and cannot be accepted.', { code: 'PROPOSAL_INVALID' });
    // The checker could not confirm the meaning is unchanged: never accepted without the user's explicit review.
    const reviews = reviewsOf(change.validation);
    if (reviews.length && !confirmReview) {
      throw ApiError.unprocessable('This proposal may change the meaning of the original. Review it and confirm to accept.', { code: 'REVIEW_REQUIRED', details: { issues: reviews } });
    }
    Object.assign(change, { decision: 'accepted', editedText: null, editValidation: null, override: null, review: reviews.length ? { confirmed: true, confirmedAt: at, issues: reviews } : null });
    change.history.push({ at, action: reviews.length ? 'accepted_after_review' : 'accepted', ...(reviews.length ? { proposedText: change.proposed, issues: reviews, reviewConfirmed: true } : {}) });
  } else if (decision === 'reject') {
    Object.assign(change, { decision: 'rejected', editedText: null, editValidation: null, override: null, review: null });
    change.history.push({ at, action: 'rejected' });
  } else if (decision === 'reset') {
    Object.assign(change, { decision: 'pending', editedText: null, editValidation: null, override: null, review: null });
    change.history.push({ at, action: 'reset' });
  } else if (decision === 'edit') {
    if (!TEXT_TYPES.has(change.type)) throw ApiError.badRequest('Only the summary and bullet text can be edited. Accept or reject order changes.', { code: 'EDIT_NOT_ALLOWED' });
    const edited = normalizeText(text);
    const validation = checkUserEdit(change, edited, factsFor(doc));
    const errors = errorsOf(validation);
    const hard = errors.filter((i) => NOT_OVERRIDABLE.has(i.code));
    if (hard.length) throw ApiError.unprocessable('The edited text cannot be used.', { code: 'EDIT_INVALID', details: { issues: hard } });
    if (errors.length && !confirmOverride) {
      throw ApiError.unprocessable('Your edit says things the master resume does not support. Confirm to use it anyway.', { code: 'CLAIM_CHECK_FAILED', details: { issues: validation.issues } });
    }
    const reviews = reviewsOf(validation);
    if (reviews.length && !confirmReview) {
      throw ApiError.unprocessable('Your edit may change the meaning of the original. Confirm that it describes what you actually did.', { code: 'REVIEW_REQUIRED', details: { issues: validation.issues } });
    }
    Object.assign(change, {
      decision: 'edited',
      editedText: edited,
      editValidation: validation,
      override: errors.length ? { confirmed: true, confirmedAt: at, issues: errors } : null,
      review: reviews.length ? { confirmed: true, confirmedAt: at, issues: reviews } : null,
    });
    change.history.push({
      at,
      action: errors.length ? 'edited_with_override' : 'edited',
      originalText: change.original,
      proposedText: change.proposed,
      editedText: edited,
      issues: validation.issues,
      overrideConfirmed: errors.length > 0,
      reviewConfirmed: reviews.length > 0,
    });
  } else {
    throw ApiError.badRequest('Unknown decision.', { code: 'VALIDATION_ERROR' });
  }

  const changes = [...doc.changes];
  changes[index] = change;
  return saveChanges(userId, doc, changes, expectedRevision);
}

/** Accepts every pending proposal that passed validation and needs no manual review. */
export async function acceptAllPassing(userId, id, { expectedRevision }) {
  const doc = await findOwned(userId, id);
  assertEditable(doc, expectedRevision);
  const at = new Date();
  const changes = withCurrentValidation(doc.changes, factsFor(doc)).map((c) =>
    c.decision === 'pending' && c.validation?.passed && !reviewsOf(c.validation).length && validOrder(c, doc.baseContent) ? { ...c, decision: 'accepted', history: [...(c.history ?? []), { at, action: 'accepted', bulk: true }] } : c,
  );
  return saveChanges(userId, doc, changes, expectedRevision);
}

/**
 * Full pre-approval validation of the resulting document. Returns { passed, report }.
 * Also used again right before PDF generation.
 */
export function validateDocument(doc, content) {
  const facts = factsFor(doc);
  const problems = [];
  const claims = [];
  for (const change of doc.changes) {
    if (change.decision === 'pending') problems.push({ code: 'DECISIONS_PENDING', message: `“${change.changeId}” has no decision yet.` });
    if (!['accepted', 'edited'].includes(change.decision)) continue;
    if (!validOrder(change, doc.baseContent)) problems.push({ code: 'ORDER_INVALID', message: `“${change.changeId}” is not a valid re-ordering.` });
    if (!TEXT_TYPES.has(change.type)) continue;
    const text = effectiveText(change);
    const result =
      change.decision === 'accepted'
        ? checkClaim({ text, original: change.original, target: change.target, evidenceIds: change.evidenceIds, author: 'ai' }, facts)
        : checkUserEdit(change, text, facts);
    const errors = errorsOf(result);
    const overridden = change.decision === 'edited' && change.override?.confirmed && errors.every((e) => !NOT_OVERRIDABLE.has(e.code));
    claims.push({ changeId: change.changeId, decision: change.decision, passed: result.passed, overridden: !result.passed && overridden, issues: result.issues });
    if (!result.passed && !overridden) problems.push({ code: 'UNSUPPORTED_CLAIM', message: `“${change.changeId}” contains unsupported claims.` });
    // Every possible change of meaning found NOW must have been confirmed by the user, for this exact text.
    const reviewKey = (issue) => `${issue.code}|${issue.message}`;
    const confirmedCodes = new Set(change.review?.confirmed ? change.review.issues.map(reviewKey) : []);
    const unconfirmed = reviewsOf(result).filter((issue) => !confirmedCodes.has(reviewKey(issue)));
    if (unconfirmed.length) problems.push({ code: 'REVIEW_NOT_CONFIRMED', message: `“${change.changeId}” may change the meaning of the original and has not been confirmed: ${unconfirmed.map((i) => i.message).join(' ')}` });
  }
  const locked = verifyLockedFields(doc.baseContent, content);
  locked.forEach((m) => problems.push({ code: 'LOCKED_FIELD_CHANGED', message: m }));
  const badChars = unsupportedCharacters(allResumeText(content));
  if (badChars.length) problems.push({ code: 'UNSUPPORTED_CHARACTER', message: `Characters the resume font cannot print: ${badChars.join(' ')}` });
  const layout = layoutReport(doc.baseContent, content, rewordedPairs(doc.changes));
  layout.errors.forEach((m) => problems.push({ code: 'LAYOUT_INVALID', message: m }));
  return {
    passed: problems.length === 0,
    report: { checkedAt: new Date(), problems, claims, overrides: claims.filter((c) => c.overridden).length, lockedFieldsIntact: locked.length === 0, layout },
  };
}

export async function approveTailoredResume(userId, id, { expectedRevision }) {
  const doc = await findOwned(userId, id);
  assertEditable(doc, expectedRevision);
  await assertMasterCurrent(userId, doc);
  const content = buildContent(doc.baseContent, doc.changes);
  const { passed, report } = validateDocument(doc, content);
  if (!passed) throw ApiError.unprocessable('The tailored resume is not ready for approval.', { code: 'APPROVAL_BLOCKED', details: { problems: report.problems, layout: report.layout } });

  const result = await TailoredResume.updateOne(
    { _id: doc._id, userId, revision: expectedRevision, status: 'draft' },
    { $set: { status: 'approved', finalContent: content, contentHash: contentHash(content), approvedAt: new Date(), validationReport: report }, $inc: { revision: 1 } },
  );
  if (!result.matchedCount) throw ApiError.conflict('This version was changed elsewhere. Reload and try again.', { code: 'REVISION_CONFLICT' });
  return getTailoredResume(userId, id);
}

/** New draft version with the same proposals and decisions (approved versions stay frozen). */
export async function duplicateTailoredResume(userId, id) {
  const source = await findOwned(userId, id);
  await assertMasterCurrent(userId, source);
  const at = new Date();
  const doc = await insertVersion(userId, source.jobAnalysisId, {
    masterResumeId: source.masterResumeId,
    sourceResumeHash: source.sourceResumeHash,
    companyName: source.companyName,
    jobTitle: source.jobTitle,
    baseContent: source.baseContent,
    analysisSnapshot: source.analysisSnapshot,
    // Decisions are copied, but proposals are re-checked with the current rules; a confirmation of a
    // review stays valid only for the same issues (validateDocument compares them).
    changes: withCurrentValidation(source.changes, factsFor(source)).map((c) => ({ ...c, history: [...(c.history ?? []), { at, action: 'copied', fromVersion: source.versionNumber }] })),
    blocked: source.blocked,
    gaps: source.gaps,
    copiedFrom: { versionNumber: source.versionNumber, tailoredResumeId: source._id },
    ai: source.ai,
    generatorVersion: source.generatorVersion,
  });
  return getTailoredResume(userId, doc._id);
}

export async function deleteTailoredResume(userId, id, storage) {
  const doc = await findOwned(userId, id);
  await assertNotLinkedToApplication(userId, { tailoredResumeId: doc._id });
  // Stored file first: if storage fails, the record (and the way to retry) remains.
  if (doc.pdf?.cloudinaryPublicId) await storage.deleteFile(doc.pdf.cloudinaryPublicId);
  await TailoredResume.deleteOne({ _id: doc._id, userId });
}

export { findOwned as findOwnedTailoredResume };
