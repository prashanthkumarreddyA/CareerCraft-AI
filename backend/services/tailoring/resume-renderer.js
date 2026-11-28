import fs from 'node:fs';
import * as pdfLib from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
// Byte-identical copy of research/phase1/resume-template.mjs (see tests/tailored-pdf.test.js).
// It is used as-is: this module only feeds it data and reads its layout output.
import { buildParagraphs, layoutResume, renderResumePdf, RESUME_TEMPLATE } from '../../pdf/resume-template.mjs';

const FONT_FILES = { regular: 'Regular', bold: 'Bold', italic: 'Italic', boldItalic: 'BoldItalic' };
const FEATURES = { liga: false, kern: false, calt: false }; // same shaping options as the engine

// Output template registry: only classic-v1 is active for now; additional templates can be registered here later.
export const OUTPUT_TEMPLATES = {
  'classic-v1': RESUME_TEMPLATE,
};

let cache;
function fonts() {
  if (!cache) {
    const bytes = Object.fromEntries(
      Object.entries(FONT_FILES).map(([key, file]) => [key, fs.readFileSync(new URL(`../../assets/fonts/Carlito-${file}.latin.ttf`, import.meta.url))]),
    );
    const faces = Object.fromEntries(Object.entries(bytes).map(([key, b]) => [key, fontkit.create(b)]));
    // Measuring fonts exactly as renderResumePdf builds them.
    const measuring = Object.fromEntries(
      Object.entries(faces).map(([key, face]) => [
        key,
        { key, widthOfTextAtSize: (text, size) => (face.layout(text, FEATURES).glyphs.reduce((w, g) => w + g.advanceWidth, 0) * size) / face.unitsPerEm },
      ]),
    );
    cache = { bytes, faces, measuring };
  }
  return cache;
}

export const TEMPLATE = RESUME_TEMPLATE;
export const MAX_PAGES = 2;

/** Characters that no embedded face can draw (they would render blank). */
export function unsupportedCharacters(text) {
  const { faces } = fonts();
  const bad = new Set();
  for (const ch of String(text ?? '')) {
    if (/\s/.test(ch)) continue;
    const cp = ch.codePointAt(0);
    if (!Object.values(faces).every((face) => face.hasGlyphForCodePoint(cp))) bad.add(ch);
  }
  return [...bad];
}

/** Every string in a structured resume (for glyph checks). */
export function allResumeText(resume) {
  const out = [];
  const walk = (v) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(resume);
  return out.join('\n');
}

const paragraphText = (para) => para.runs.map((r) => r.text).join('');

function formatCertificationLine(cert) {
  const base = [cert.name, cert.issuer].filter(Boolean).join(' — ');
  return cert.date ? `${base} (${cert.date})` : base;
}

/**
 * Builds paragraphs using the Phase 1 engine, adding support for `certifications`
 * without modifying the frozen `backend/pdf/resume-template.mjs` file.
 */
function buildExtendedParagraphs(resume, template = RESUME_TEMPLATE) {
  const hasCertSection = (resume.certifications?.length ?? 0) > 0 && resume.sectionOrder.some((s) => s.key === 'certifications');
  if (!hasCertSection) return buildParagraphs(resume, template);

  const withoutCerts = {
    ...resume,
    sectionOrder: resume.sectionOrder.filter((s) => s.key !== 'certifications'),
  };
  const baseParagraphs = buildParagraphs(withoutCerts, template);

  // Build paragraphs for certifications in the exact same heading + bullet style,
  // inserted at the position specified by `sectionOrder`.
  const certOrderIndex = resume.sectionOrder.findIndex((s) => s.key === 'certifications');
  const certSection = resume.sectionOrder[certOrderIndex];
  const certParagraphs = [
    { style: 'heading', runs: [{ text: certSection.heading, bold: true }] },
    ...resume.certifications.map((c) => ({ style: 'bullet', runs: [{ text: template.bullet + formatCertificationLine(c) }] })),
  ];

  // Find the heading index in baseParagraphs corresponding to the next section after certifications
  const nextSection = resume.sectionOrder.slice(certOrderIndex + 1).find((s) => s.key !== 'certifications');
  if (!nextSection) return [...baseParagraphs, ...certParagraphs];

  const insertAt = baseParagraphs.findIndex((p) => p.style === 'heading' && paragraphText(p) === nextSection.heading);
  if (insertAt === -1) return [...baseParagraphs, ...certParagraphs];
  return [...baseParagraphs.slice(0, insertAt), ...certParagraphs, ...baseParagraphs.slice(insertAt)];
}

/**
 * Lays the resume out with the Phase 1 engine without producing a PDF.
 * Returns page count, overflowing lines and, per paragraph, its line count.
 */
export function layoutCheck(resume, template = RESUME_TEMPLATE) {
  const { measuring } = fonts();
  const paragraphs = buildExtendedParagraphs(resume, template);
  const layout = layoutResume(paragraphs, measuring, template);
  const contentLeft = template.margin.left;
  const contentRight = template.page.width - template.margin.right;

  const paragraphInfo = paragraphs.map((para, index) => {
    const alone = layoutResume([para], measuring, template); // wrapping is page-independent
    const lines = alone.pages.flatMap((p) => p.lines);
    const style = { indent: 0, align: 'left', ...template.styles[para.style] };
    const available = contentRight - (contentLeft + style.indent);
    const overflow = lines.some((l) => l.width > available + 0.01);
    return { index, style: para.style, text: paragraphText(para), lineCount: lines.length, overflow };
  });

  return {
    pageCount: layout.pages.length,
    lastPageFill: (() => {
      const last = layout.pages.at(-1).lines.at(-1);
      const usable = template.page.height - template.margin.top - template.margin.bottom;
      return last ? +((last.baseline - template.margin.top) / usable).toFixed(3) : 0;
    })(),
    paragraphs: paragraphInfo,
    overflowing: paragraphInfo.filter((p) => p.overflow),
  };
}

/** Renders the PDF with the Phase 1 engine (supports classic-v1 and optional certifications). */
export async function renderPdf(resume, { title, templateId = 'classic-v1' } = {}) {
  const template = OUTPUT_TEMPLATES[templateId] ?? RESUME_TEMPLATE;
  const { bytes, measuring } = fonts();

  const hasCerts = (resume.certifications?.length ?? 0) > 0 && resume.sectionOrder.some((s) => s.key === 'certifications');
  if (!hasCerts) {
    const result = await renderResumePdf(resume, { pdfLib, fontkit, fontBytes: bytes, template, metadata: title ? { title } : {} });
    return { bytes: Buffer.from(result.bytes), report: result.report };
  }

  const { PDFDocument, rgb } = pdfLib;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const embedOptions = { subset: false, features: FEATURES };
  const paragraphs = buildExtendedParagraphs(resume, template);
  const layout = layoutResume(paragraphs, measuring, template);
  const used = new Set(layout.pages.flatMap((p) => p.lines.flatMap((l) => l.pieces.map((x) => x.font.key))));
  const embedded = {};
  for (const key of used) embedded[key] = await doc.embedFont(bytes[key], embedOptions);
  for (const page of layout.pages) for (const line of page.lines) for (const piece of line.pieces) piece.font = embedded[piece.font.key];

  const color = rgb(template.color.r, template.color.g, template.color.b);
  const H = template.page.height;

  for (const pageLayout of layout.pages) {
    const page = doc.addPage([template.page.width, H]);
    for (const line of pageLayout.lines) {
      let x = line.x;
      let runText = '';
      let runFont = null;
      let runX = x;
      const flush = () => {
        if (runText) page.drawText(runText, { x: runX, y: H - line.baseline, size: line.size, font: runFont, color });
      };
      for (const piece of line.pieces) {
        if (piece.font !== runFont) {
          flush();
          runText = '';
          runFont = piece.font;
          runX = x;
        }
        runText += piece.text;
        x += piece.width;
      }
      flush();
    }
    for (const r of pageLayout.rules) {
      page.drawRectangle({ x: r.x0, y: H - r.top - r.thickness, width: r.x1 - r.x0, height: r.thickness, color });
    }
  }

  doc.setTitle(title ?? `${resume.personalInfo.fullName} – Resume`);
  doc.setAuthor(resume.personalInfo.fullName);
  doc.setCreator('CareerCraft AI');
  doc.setProducer('CareerCraft AI (pdf-lib)');

  const last = layout.pages[layout.pages.length - 1].lines.at(-1);
  const usable = H - template.margin.top - template.margin.bottom;
  const report = {
    pageCount: layout.pages.length,
    lastPageFill: last ? +((last.baseline - template.margin.top) / usable).toFixed(3) : 0,
  };
  return { bytes: Buffer.from(await doc.save()), report };
}
