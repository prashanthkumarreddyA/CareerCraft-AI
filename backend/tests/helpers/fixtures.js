// Test fixtures generated at runtime so no PDF (and no personal data) is committed.
// The sample resume PDF is rendered with the validated Phase 1 template engine
// (research/phase1/resume-template.mjs) and Carlito fonts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pdfLib from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '../../..');
const phase1 = path.join(repoRoot, 'research/phase1');

export const sampleResume = JSON.parse(fs.readFileSync(path.join(here, '../fixtures/sample-resume.json'), 'utf8'));

let samplePdfCache;
export async function samplePdf(resume = sampleResume) {
  if (resume === sampleResume && samplePdfCache) return samplePdfCache;
  const { renderResumePdf } = await import(pathToUrl(path.join(phase1, 'resume-template.mjs')));
  const font = (v) => fs.readFileSync(path.join(phase1, 'fonts', `Carlito-${v}.latin.ttf`));
  const fontBytes = { regular: font('Regular'), bold: font('Bold'), italic: font('Italic'), boldItalic: font('BoldItalic') };
  const { bytes } = await renderResumePdf(resume, { pdfLib, fontkit, fontBytes });
  const buffer = Buffer.from(bytes);
  if (resume === sampleResume) samplePdfCache = buffer;
  return buffer;
}

/** A valid PDF with no text at all (what a scanned/image-only resume looks like to the extractor). */
export async function blankPdf() {
  const doc = await pdfLib.PDFDocument.create();
  doc.addPage([612, 792]);
  return Buffer.from(await doc.save());
}

/** A valid PDF with text that does not follow the resume template (no section headings). */
export async function unstructuredPdf() {
  const doc = await pdfLib.PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(pdfLib.StandardFonts.Helvetica);
  page.drawText('Quarterly meeting notes', { x: 50, y: 780, size: 14, font });
  page.drawText('Nothing here resembles a resume.', { x: 50, y: 760, size: 11, font });
  return Buffer.from(await doc.save());
}

/** Starts with a PDF header but the body is garbage. */
export function corruptedPdf() {
  return Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('this is not a real pdf body '.repeat(50))]);
}

export const realResumePaths = {
  pdf: path.join(phase1, 'original-resume.pdf'),
  baselineJson: path.join(phase1, 'output/master-resume.json'),
  baselineLines: path.join(phase1, 'output/extracted-lines.json'),
};

function pathToUrl(p) {
  return new URL(`file:///${p.replace(/\\/g, '/')}`).href;
}
