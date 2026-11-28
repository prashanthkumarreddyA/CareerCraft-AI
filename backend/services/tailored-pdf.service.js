import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { TailoredResume } from '../models/TailoredResume.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { STORAGE_FOLDERS } from './cloudinary.service.js';
import { extractResumeFromPdf } from './pdf-extraction.service.js';
import { checkTemplateCompatibility } from './template-check.service.js';
import { buildContent, contentHash } from './tailoring/content-builder.js';
import { MAX_PAGES, renderPdf, TEMPLATE } from './tailoring/resume-renderer.js';
import { assertMasterCurrent, findOwnedTailoredResume, getTailoredResume, validateDocument } from './tailored-resume.service.js';

/**
 * PDF generation for APPROVED tailored resumes only. The PDF is rendered with the unchanged
 * Phase 1 engine and must pass every check below before it is stored (privately) or offered.
 */

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const SECTIONS = ['personalInfo', 'headline', 'summary', 'technicalSkills', 'experience', 'projects', 'education', 'certifications', 'achievements', 'sectionOrder'];

/** Line-level comparison with the master resume rendered by the same engine. */
export function compareWithMaster(tailored, master) {
  const tLines = tailored.extractedContent.lines;
  const mLines = master.extractedContent.lines;
  const key = (l) => `${l.page}|${l.text}|${Math.round(l.x * 10)}|${Math.round(l.baseline * 10)}`;
  const masterKeys = new Set(mLines.map(key));
  // Style = size + bold/italic of every run (e.g. "10.5/b"), plus the embedded font families.
  const styleSet = (lines) => [...new Set(lines.flatMap((l) => l.runs.map((r) => `${l.size}/${r.bold ? 'b' : ''}${r.italic ? 'i' : ''}`)))].sort();
  const leftEdge = (lines) => Math.min(...lines.map((l) => l.x));
  // pdf.js appends a per-document id to font names ("Carlito-Bold-6475"); compare families only.
  const families = (x) => [...new Set(x.extractedContent.fonts.map((f) => String(f).replace(/^[A-Z]{6}\+/, '').replace(/-\d+$/, '')))].sort();
  return {
    linesTailored: tLines.length,
    linesMaster: mLines.length,
    identicalLines: tLines.filter((l) => masterKeys.has(key(l))).length,
    sameFontsAndSizes: isDeepStrictEqual(styleSet(tLines), styleSet(mLines)) && isDeepStrictEqual(families(tailored), families(master)),
    fonts: families(tailored),
    sameLeftMargin: Math.abs(leftEdge(tLines) - leftEdge(mLines)) < 0.5,
    sameHeadings: isDeepStrictEqual(tailored.structuredResumeData.sectionOrder, master.structuredResumeData.sectionOrder),
  };
}

/** Renders and verifies. Returns { bytes, validation } where validation.passed gates storage. */
export async function renderAndValidate(doc) {
  const content = doc.finalContent;
  const problems = [];
  if (contentHash(content) !== doc.contentHash) problems.push({ code: 'CONTENT_HASH_MISMATCH', message: 'The approved content does not match its recorded hash.' });
  // Every difference from the master snapshot must come from a recorded decision.
  if (!isDeepStrictEqual(buildContent(doc.baseContent, doc.changes), content)) problems.push({ code: 'CONTENT_NOT_FROM_DECISIONS', message: 'The approved content does not match the recorded decisions.' });

  // Final gate: claims, locked fields, glyphs and layout are re-checked on the frozen content.
  const documentCheck = validateDocument(doc, content);
  problems.push(...documentCheck.report.problems);

  const { bytes, report } = await renderPdf(content);
  if (report.pageCount > MAX_PAGES) problems.push({ code: 'TOO_MANY_PAGES', message: `The PDF has ${report.pageCount} pages; the maximum is ${MAX_PAGES}.` });

  // Missing/altered content: read the PDF back with the Phase 3 extractor; it must equal the approved content.
  let extraction = null;
  try {
    extraction = await extractResumeFromPdf(bytes);
  } catch (err) {
    problems.push({ code: 'PDF_UNREADABLE', message: `The generated PDF could not be read back (${err.code ?? 'error'}).` });
  }
  let roundTrip = null;
  let template = null;
  let comparison = null;
  if (extraction) {
    const differing = SECTIONS.filter((s) => {
      if (s === 'certifications' && !(content.certifications?.length) && !(extraction.structuredResumeData.certifications?.length)) return false;
      return !isDeepStrictEqual(extraction.structuredResumeData[s], content[s]);
    });
    roundTrip = { identical: differing.length === 0, differingSections: differing };
    if (differing.length) problems.push({ code: 'CONTENT_MISMATCH', message: `Text in the PDF differs from the approved content in: ${differing.join(', ')}.` });
    template = checkTemplateCompatibility(extraction);
    if (!template.compatible || template.templateId !== TEMPLATE.id) problems.push({ code: 'TEMPLATE_MISMATCH', message: `The PDF does not match the ${TEMPLATE.id} template: ${template.issues.join(' ')}` });
    if (extraction.extractedContent.pageCount !== report.pageCount) problems.push({ code: 'PAGE_COUNT_MISMATCH', message: 'Page count differs between layout and PDF.' });

    const master = await extractResumeFromPdf((await renderPdf(doc.baseContent)).bytes);
    comparison = compareWithMaster(extraction, master);
    if (!comparison.sameFontsAndSizes) problems.push({ code: 'STYLE_MISMATCH', message: 'Fonts or font sizes differ from the master resume template.' });
    if (!comparison.sameLeftMargin) problems.push({ code: 'MARGIN_MISMATCH', message: 'Margins differ from the master resume template.' });
    if (!comparison.sameHeadings) problems.push({ code: 'HEADINGS_MISMATCH', message: 'Section headings differ from the master resume.' });
  }

  return {
    bytes,
    validation: {
      passed: problems.length === 0,
      checkedAt: new Date(),
      problems,
      pageCount: report.pageCount,
      maxPages: MAX_PAGES,
      lastPageFill: report.lastPageFill,
      layout: documentCheck.report.layout,
      claims: { checked: documentCheck.report.claims.length, overrides: documentCheck.report.overrides },
      roundTrip,
      template: template && { templateId: template.templateId, compatible: template.compatible, issues: template.issues },
      comparisonWithMaster: comparison,
    },
  };
}

export async function generateTailoredPdf(userId, id, storage) {
  const doc = await findOwnedTailoredResume(userId, id);
  if (doc.status === 'draft') throw ApiError.conflict('Approve the content before generating the PDF.', { code: 'NOT_APPROVED' });
  if (doc.status === 'pdf_ready') throw ApiError.conflict('The PDF for this version already exists.', { code: 'PDF_EXISTS' });
  await assertMasterCurrent(userId, doc);

  const { bytes, validation } = await renderAndValidate(doc);
  if (!validation.passed) {
    await TailoredResume.updateOne({ _id: doc._id, userId }, { $set: { 'pdf.validation': validation } });
    throw ApiError.unprocessable('The PDF did not pass validation, so it was not made available.', { code: 'PDF_VALIDATION_FAILED', details: { problems: validation.problems } });
  }

  const { publicId } = await storage.uploadPdf(bytes, { folder: `${STORAGE_FOLDERS.customized}/${userId}` });
  try {
    const result = await TailoredResume.updateOne(
      { _id: doc._id, userId, status: 'approved', contentHash: doc.contentHash },
      {
        $set: {
          status: 'pdf_ready',
          pdf: { cloudinaryPublicId: publicId, fileHash: sha256(bytes), fileSize: bytes.length, pageCount: validation.pageCount, templateId: TEMPLATE.id, generatedAt: new Date(), validation },
        },
        $inc: { revision: 1 },
      },
    );
    if (!result.matchedCount) throw ApiError.conflict('This version changed while the PDF was being generated. Try again.', { code: 'REVISION_CONFLICT' });
  } catch (err) {
    try {
      await storage.deleteFile(publicId); // compensate: never leave an unreferenced private file
    } catch {
      logger.warn('Could not delete stored file; it is orphaned and should be removed manually', { reason: 'pdf-record-failed', publicId });
    }
    throw err;
  }
  return getTailoredResume(userId, id);
}

const fileNameFor = (doc) => {
  const slug = String(doc.companyName).normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'job';
  return `resume-${slug}-v${doc.versionNumber}.pdf`;
};

async function pdfDoc(userId, id) {
  const doc = await findOwnedTailoredResume(userId, id);
  if (doc.status !== 'pdf_ready' || !doc.pdf?.cloudinaryPublicId) throw ApiError.notFound('No PDF has been generated for this version yet.', { code: 'PDF_NOT_FOUND' });
  return doc;
}

export async function getTailoredPdfFile(userId, id, storage) {
  const doc = await pdfDoc(userId, id);
  const buffer = await storage.fetchFile(doc.pdf.cloudinaryPublicId);
  if (sha256(buffer) !== doc.pdf.fileHash) {
    throw ApiError.badGateway('The stored PDF failed its integrity check.', { code: 'FILE_INTEGRITY_ERROR' });
  }
  return { buffer, fileName: fileNameFor(doc) };
}

export async function getTailoredPdfDownloadUrl(userId, id, storage) {
  const doc = await pdfDoc(userId, id);
  return storage.getSignedUrl(doc.pdf.cloudinaryPublicId);
}
