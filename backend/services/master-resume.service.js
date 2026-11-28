import crypto from 'node:crypto';
import { MasterResume } from '../models/MasterResume.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { extractResumeFromPdf, extractRawPdfText, ExtractionError, EXTRACTOR_VERSION } from './pdf-extraction.service.js';
import { parseResumeWithAi } from './resume-parser.service.js';
import { checkTemplateCompatibility } from './template-check.service.js';
import { structuredResumeSchema, describeSchemaIssues } from '../validators/resume.schema.js';
import { STORAGE_FOLDERS } from './cloudinary.service.js';

const PDF_MAGIC = Buffer.from('%PDF-');

export const computeProfileHash = (structuredResumeData) =>
  crypto.createHash('sha256').update(JSON.stringify(structuredResumeData)).digest('hex');

/** Public view of a master resume / user profile (no Cloudinary identifiers, no raw line dump unless asked). */
export function toPublicMasterResume(doc, { includeLines = false } = {}) {
  const { lines, ...extractedSummary } = doc.extractedContent ?? {};
  return {
    id: String(doc._id),
    source: doc.source ?? 'pdf_upload',
    hasPdf: Boolean(doc.cloudinaryPublicId),
    originalFileName: doc.originalFileName ?? null,
    fileFormat: doc.fileFormat ?? null,
    fileSize: doc.fileSize ?? null,
    fileHash: doc.fileHash ?? null,
    profileHash: doc.profileHash ?? doc.fileHash ?? null,
    pageCount: doc.pageCount ?? null,
    templateId: doc.templateId ?? null,
    templateCompatibility: doc.templateCompatibility ?? { compatible: false, issues: [] },
    extractorVersion: doc.extractorVersion ?? 'manual-v1',
    uploadedAt: doc.uploadedAt ?? null,
    updatedAt: doc.updatedAt,
    structuredResumeData: doc.structuredResumeData,
    extractedContent: doc.extractedContent ? (includeLines ? doc.extractedContent : extractedSummary) : null,
    // Storage ids are never exposed; backups are addressed by their own id.
    backups: (doc.backups ?? []).map((b) => ({
      id: String(b._id),
      originalFileName: b.originalFileName,
      fileSize: b.fileSize,
      fileHash: b.fileHash,
      pageCount: b.pageCount,
      uploadedAt: b.uploadedAt,
      replacedAt: b.replacedAt,
    })),
  };
}

/** Validates the upload and extracts it (deterministic Phase 1 first, AI universal fallback for any other layout). */
async function processUpload(file, ai) {
  if (!file?.buffer?.length) throw ApiError.badRequest('Choose a PDF file to upload.', { code: 'FILE_REQUIRED' });
  // The PDF header must appear within the first 1024 bytes (PDF spec); the MIME type is client-supplied.
  if (!file.buffer.subarray(0, 1024).includes(PDF_MAGIC)) {
    throw new ApiError(415, 'The file is not a PDF.', { code: 'UNSUPPORTED_FILE_TYPE' });
  }

  let extraction = null;
  let parsed = null;
  let fallbackReason = null;

  try {
    extraction = await extractResumeFromPdf(file.buffer);
    parsed = structuredResumeSchema.safeParse(extraction.structuredResumeData);
    if (!parsed.success || (extraction.unknownSections?.length ?? 0) > 0) {
      fallbackReason = 'layout_mismatch';
    }
  } catch (err) {
    if (err instanceof ExtractionError && err.code === 'UNSUPPORTED_LAYOUT') {
      fallbackReason = 'unsupported_layout';
    } else if (err instanceof ExtractionError) {
      throw ApiError.unprocessable(err.message, { code: err.code });
    } else {
      throw err;
    }
  }

  let structuredData;
  let extractedContent;
  let unknownSections = [];
  let extractorVersion = EXTRACTOR_VERSION;

  if (!fallbackReason && parsed?.success) {
    structuredData = parsed.data;
    extractedContent = { ...extraction.extractedContent, unknownSections: extraction.unknownSections };
    unknownSections = extraction.unknownSections;
  } else if (ai && ai.isConfigured !== false) {
    let raw;
    try {
      raw = await extractRawPdfText(file.buffer);
    } catch (err) {
      if (err instanceof ExtractionError) throw ApiError.unprocessable(err.message, { code: err.code });
      throw err;
    }
    structuredData = await parseResumeWithAi(raw.text, ai);
    extractedContent = { ...raw.extractedContent, unknownSections: [] };
    extractorVersion = 'ai-universal-v1';
  } else if (parsed && !parsed.success) {
    throw ApiError.unprocessable('The resume was read, but its structure could not be recognised completely.', {
      code: 'EXTRACTION_INVALID',
      details: describeSchemaIssues(parsed.error),
    });
  } else {
    throw ApiError.unprocessable('The resume layout could not be recognised.', { code: 'UNSUPPORTED_LAYOUT' });
  }

  const compatibility = checkTemplateCompatibility({
    structuredResumeData: structuredData,
    extractedContent,
    unknownSections,
  });

  return {
    source: 'pdf_upload',
    originalFileName: sanitizeFileName(file.originalname),
    fileFormat: 'pdf',
    fileSize: file.buffer.length,
    fileHash: crypto.createHash('sha256').update(file.buffer).digest('hex'),
    profileHash: computeProfileHash(structuredData),
    pageCount: extractedContent.pageCount,
    extractedContent,
    structuredResumeData: structuredData,
    templateId: compatibility.templateId,
    templateCompatibility: { compatible: compatibility.compatible, issues: compatibility.issues },
    extractorVersion,
  };
}

function sanitizeFileName(name = '') {
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  const cleaned = decoded.replace(/[\\/]/g, '_').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (cleaned || 'resume.pdf').slice(0, 255);
}

async function deleteQuietly(storage, publicId, reason) {
  try {
    await storage.deleteFile(publicId);
  } catch {
    logger.warn('Could not delete stored file; it is orphaned and should be removed manually', { reason, publicId });
  }
}

export async function getMasterResume(userId, options) {
  const doc = await MasterResume.findOne({ userId });
  if (!doc) throw ApiError.notFound('No master resume or profile created yet.', { code: 'MASTER_RESUME_NOT_FOUND' });
  return toPublicMasterResume(doc, options);
}

/** First upload. Fails with 409 if the user already has a master resume (use replace). */
export async function createMasterResume(userId, file, storage, ai) {
  const processed = await processUpload(file, ai);
  if (await MasterResume.exists({ userId })) {
    throw ApiError.conflict('You already have a master resume. Replace it instead of uploading a second one.', { code: 'MASTER_RESUME_EXISTS' });
  }

  const { publicId } = await storage.uploadPdf(file.buffer, { folder: `${STORAGE_FOLDERS.master}/${userId}` });
  try {
    const doc = await MasterResume.create({ ...processed, userId, cloudinaryPublicId: publicId, uploadedAt: new Date() });
    return toPublicMasterResume(doc);
  } catch (err) {
    await deleteQuietly(storage, publicId, 'create-rollback');
    if (err?.code === 11000) {
      throw ApiError.conflict('You already have a master resume. Replace it instead of uploading a second one.', { code: 'MASTER_RESUME_EXISTS' });
    }
    throw err;
  }
}

/**
 * Replaces the stored PDF and its extracted content. The previous PDF (if any) is NOT deleted:
 * it is kept as a private backup, downloadable by the owner.
 */
export async function replaceMasterResume(userId, file, storage, ai) {
  const existing = await MasterResume.findOne({ userId });
  if (!existing) throw ApiError.notFound('No master resume to replace. Upload one first.', { code: 'MASTER_RESUME_NOT_FOUND' });
  const processed = await processUpload(file, ai);

  const { publicId } = await storage.uploadPdf(file.buffer, { folder: `${STORAGE_FOLDERS.master}/${userId}` });
  const filter = existing.cloudinaryPublicId
    ? { _id: existing._id, cloudinaryPublicId: existing.cloudinaryPublicId }
    : { _id: existing._id, cloudinaryPublicId: { $exists: false } };
  const update = { $set: { ...processed, cloudinaryPublicId: publicId, uploadedAt: new Date() } };
  if (existing.cloudinaryPublicId) {
    update.$push = {
      backups: {
        cloudinaryPublicId: existing.cloudinaryPublicId,
        originalFileName: existing.originalFileName,
        fileSize: existing.fileSize,
        fileHash: existing.fileHash,
        pageCount: existing.pageCount,
        uploadedAt: existing.uploadedAt,
        replacedAt: new Date(),
      },
    };
  }

  let updated;
  try {
    updated = await MasterResume.findOneAndUpdate(filter, update, { returnDocument: 'after', runValidators: true });
  } catch (err) {
    await deleteQuietly(storage, publicId, 'replace-rollback');
    throw err;
  }
  if (!updated) {
    await deleteQuietly(storage, publicId, 'replace-conflict');
    throw ApiError.conflict('The resume was changed by another request. Please reload and try again.', { code: 'CONCURRENT_UPDATE' });
  }
  return toPublicMasterResume(updated);
}

/**
 * Creates or updates the user's structured profile manually (without requiring a new PDF upload).
 * Updates `profileHash` so downstream analyses/tailorings detect profile edits as stale.
 */
export async function upsertMasterProfile(userId, profileData) {
  const parsed = structuredResumeSchema.safeParse(profileData);
  if (!parsed.success) {
    throw ApiError.badRequest('Profile data is invalid.', {
      code: 'VALIDATION_ERROR',
      details: describeSchemaIssues(parsed.error),
    });
  }
  const structuredData = parsed.data;
  const profileHash = computeProfileHash(structuredData);

  const existing = await MasterResume.findOne({ userId });
  if (existing) {
    const source = existing.cloudinaryPublicId ? 'pdf_and_manual' : 'manual';
    const updated = await MasterResume.findOneAndUpdate(
      { _id: existing._id },
      { $set: { structuredResumeData: structuredData, profileHash, source } },
      { returnDocument: 'after', runValidators: true },
    );
    return toPublicMasterResume(updated);
  }

  const doc = await MasterResume.create({
    userId,
    source: 'manual',
    profileHash,
    structuredResumeData: structuredData,
    templateId: 'classic-v1',
    templateCompatibility: { compatible: true, issues: [] },
    extractorVersion: 'manual-v1',
  });
  return toPublicMasterResume(doc);
}

/**
 * Deletes the stored file and every backup first: if storage fails, the record is kept so the
 * user can retry (already-deleted backups are removed from the record).
 */
export async function deleteMasterResume(userId, storage) {
  const existing = await MasterResume.findOne({ userId });
  if (!existing) throw ApiError.notFound('No master resume to delete.', { code: 'MASTER_RESUME_NOT_FOUND' });
  for (const backup of existing.backups ?? []) {
    await storage.deleteFile(backup.cloudinaryPublicId);
    await MasterResume.updateOne({ _id: existing._id }, { $pull: { backups: { _id: backup._id } } });
  }
  if (existing.cloudinaryPublicId) {
    await storage.deleteFile(existing.cloudinaryPublicId);
  }
  await MasterResume.deleteOne({ _id: existing._id });
}

async function findBackup(userId, backupId) {
  const doc = await MasterResume.findOne({ userId }).select('backups');
  if (!doc) throw ApiError.notFound('No master resume uploaded yet.', { code: 'MASTER_RESUME_NOT_FOUND' });
  const backup = doc.backups.find((b) => String(b._id) === String(backupId));
  if (!backup) throw ApiError.notFound('Backup not found.', { code: 'BACKUP_NOT_FOUND' });
  return backup;
}

/** Bytes of a previous master resume PDF, verified against the hash recorded at its upload. */
export async function getMasterBackupFile(userId, backupId, storage) {
  const backup = await findBackup(userId, backupId);
  const buffer = await storage.fetchFile(backup.cloudinaryPublicId);
  if (crypto.createHash('sha256').update(buffer).digest('hex') !== backup.fileHash) {
    logger.error('Stored master resume backup failed integrity check', { backupId: String(backup._id) });
    throw ApiError.badGateway('The stored file failed an integrity check.', { code: 'FILE_INTEGRITY_ERROR' });
  }
  return { buffer, fileName: backup.originalFileName };
}

export async function getMasterBackupDownloadUrl(userId, backupId, storage) {
  const backup = await findBackup(userId, backupId);
  return storage.getSignedUrl(backup.cloudinaryPublicId, { attachment: true });
}

/** Original PDF bytes for the owner, verified against the hash recorded at upload. */
export async function getMasterResumeFile(userId, storage) {
  const doc = await MasterResume.findOne({ userId }).select('cloudinaryPublicId fileHash originalFileName');
  if (!doc) throw ApiError.notFound('No master resume uploaded yet.', { code: 'MASTER_RESUME_NOT_FOUND' });
  if (!doc.cloudinaryPublicId) throw ApiError.notFound('No PDF file is attached to this profile.', { code: 'MASTER_PDF_NOT_FOUND' });
  const buffer = await storage.fetchFile(doc.cloudinaryPublicId);
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  if (hash !== doc.fileHash) {
    logger.error('Stored master resume failed integrity check', { masterResumeId: String(doc._id) });
    throw ApiError.badGateway('The stored file failed an integrity check.', { code: 'FILE_INTEGRITY_ERROR' });
  }
  return { buffer, fileName: doc.originalFileName };
}

export async function getMasterResumeDownloadUrl(userId, storage) {
  const doc = await MasterResume.findOne({ userId }).select('cloudinaryPublicId');
  if (!doc) throw ApiError.notFound('No master resume uploaded yet.', { code: 'MASTER_RESUME_NOT_FOUND' });
  if (!doc.cloudinaryPublicId) throw ApiError.notFound('No PDF file is attached to this profile.', { code: 'MASTER_PDF_NOT_FOUND' });
  return storage.getSignedUrl(doc.cloudinaryPublicId, { attachment: true });
}
