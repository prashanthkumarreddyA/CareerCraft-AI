import crypto from 'node:crypto';
import { MasterResume } from '../models/MasterResume.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { extractResumeFromPdf, ExtractionError, EXTRACTOR_VERSION } from './pdf-extraction.service.js';
import { checkTemplateCompatibility } from './template-check.service.js';
import { structuredResumeSchema, describeSchemaIssues } from '../validators/resume.schema.js';
import { STORAGE_FOLDERS } from './cloudinary.service.js';

const PDF_MAGIC = Buffer.from('%PDF-');

/** Public view of a master resume (no Cloudinary identifiers, no raw line dump unless asked). */
export function toPublicMasterResume(doc, { includeLines = false } = {}) {
  const { lines, ...extractedSummary } = doc.extractedContent ?? {};
  return {
    id: String(doc._id),
    originalFileName: doc.originalFileName,
    fileFormat: doc.fileFormat,
    fileSize: doc.fileSize,
    fileHash: doc.fileHash,
    pageCount: doc.pageCount,
    templateId: doc.templateId,
    templateCompatibility: doc.templateCompatibility,
    extractorVersion: doc.extractorVersion,
    uploadedAt: doc.uploadedAt,
    updatedAt: doc.updatedAt,
    structuredResumeData: doc.structuredResumeData,
    extractedContent: includeLines ? doc.extractedContent : extractedSummary,
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

/** Validates the upload and extracts it. Nothing is stored yet. */
async function processUpload(file) {
  if (!file?.buffer?.length) throw ApiError.badRequest('Choose a PDF file to upload.', { code: 'FILE_REQUIRED' });
  // The PDF header must appear within the first 1024 bytes (PDF spec); the MIME type is client-supplied.
  if (!file.buffer.subarray(0, 1024).includes(PDF_MAGIC)) {
    throw new ApiError(415, 'The file is not a PDF.', { code: 'UNSUPPORTED_FILE_TYPE' });
  }

  let extraction;
  try {
    extraction = await extractResumeFromPdf(file.buffer);
  } catch (err) {
    if (err instanceof ExtractionError) throw ApiError.unprocessable(err.message, { code: err.code });
    throw err;
  }

  const parsed = structuredResumeSchema.safeParse(extraction.structuredResumeData);
  if (!parsed.success) {
    throw ApiError.unprocessable('The resume was read, but its structure could not be recognised completely.', {
      code: 'EXTRACTION_INVALID',
      details: describeSchemaIssues(parsed.error),
    });
  }

  const compatibility = checkTemplateCompatibility(extraction);
  return {
    originalFileName: sanitizeFileName(file.originalname),
    fileFormat: 'pdf',
    fileSize: file.buffer.length,
    fileHash: crypto.createHash('sha256').update(file.buffer).digest('hex'),
    pageCount: extraction.extractedContent.pageCount,
    extractedContent: { ...extraction.extractedContent, unknownSections: extraction.unknownSections },
    structuredResumeData: parsed.data,
    templateId: compatibility.templateId,
    templateCompatibility: { compatible: compatibility.compatible, issues: compatibility.issues },
    extractorVersion: EXTRACTOR_VERSION,
  };
}

function sanitizeFileName(name = '') {
  // multer decodes multipart file names as latin1; restore UTF-8 and strip path/control chars
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  const cleaned = decoded.replace(/[\\/]/g, '_').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (cleaned || 'resume.pdf').slice(0, 255);
}

async function deleteQuietly(storage, publicId, reason) {
  try {
    await storage.deleteFile(publicId);
  } catch {
    // Logged with the opaque asset id only; an orphaned private file is not publicly reachable.
    logger.warn('Could not delete stored file; it is orphaned and should be removed manually', { reason, publicId });
  }
}

export async function getMasterResume(userId, options) {
  const doc = await MasterResume.findOne({ userId });
  if (!doc) throw ApiError.notFound('No master resume uploaded yet.', { code: 'MASTER_RESUME_NOT_FOUND' });
  return toPublicMasterResume(doc, options);
}

/** First upload. Fails with 409 if the user already has a master resume (use replace). */
export async function createMasterResume(userId, file, storage) {
  const processed = await processUpload(file);
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
      // a concurrent upload for the same user won the race
      throw ApiError.conflict('You already have a master resume. Replace it instead of uploading a second one.', { code: 'MASTER_RESUME_EXISTS' });
    }
    throw err;
  }
}

/**
 * Replaces the stored PDF and its extracted content. The previous PDF is NOT deleted: it is kept
 * as a private backup (same Cloudinary asset, recorded in `backups`), downloadable by the owner.
 */
export async function replaceMasterResume(userId, file, storage) {
  const existing = await MasterResume.findOne({ userId });
  if (!existing) throw ApiError.notFound('No master resume to replace. Upload one first.', { code: 'MASTER_RESUME_NOT_FOUND' });
  const processed = await processUpload(file);

  const { publicId } = await storage.uploadPdf(file.buffer, { folder: `${STORAGE_FOLDERS.master}/${userId}` });
  let updated;
  try {
    // Conditional on the previous file id, so two concurrent replaces cannot both win.
    updated = await MasterResume.findOneAndUpdate(
      { _id: existing._id, cloudinaryPublicId: existing.cloudinaryPublicId },
      {
        $set: { ...processed, cloudinaryPublicId: publicId, uploadedAt: new Date() },
        $push: {
          backups: {
            cloudinaryPublicId: existing.cloudinaryPublicId,
            originalFileName: existing.originalFileName,
            fileSize: existing.fileSize,
            fileHash: existing.fileHash,
            pageCount: existing.pageCount,
            uploadedAt: existing.uploadedAt,
            replacedAt: new Date(),
          },
        },
      },
      { returnDocument: 'after', runValidators: true },
    );
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
  await storage.deleteFile(existing.cloudinaryPublicId);
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
  return storage.getSignedUrl(doc.cloudinaryPublicId, { attachment: true });
}
