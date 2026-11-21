import fs from 'node:fs';
import * as pdfLib from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
// Byte-identical copy of research/phase1/resume-template.mjs (see tests/tailored-pdf.test.js).
// It is used as-is: this module only feeds it data and reads its layout output.
import { buildParagraphs, layoutResume, renderResumePdf, RESUME_TEMPLATE } from '../../pdf/resume-template.mjs';

const FONT_FILES = { regular: 'Regular', bold: 'Bold', italic: 'Italic', boldItalic: 'BoldItalic' };
const FEATURES = { liga: false, kern: false, calt: false }; // same shaping options as the engine

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

/**
 * Lays the resume out with the Phase 1 engine without producing a PDF.
 * Returns page count, overflowing lines and, per paragraph, its line count.
 */
export function layoutCheck(resume, template = RESUME_TEMPLATE) {
  const { measuring } = fonts();
  const paragraphs = buildParagraphs(resume, template);
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

/** Renders the PDF with the unchanged Phase 1 engine. */
export async function renderPdf(resume, { title } = {}) {
  const { bytes } = fonts();
  const result = await renderResumePdf(resume, { pdfLib, fontkit, fontBytes: bytes, metadata: title ? { title } : {} });
  return { bytes: Buffer.from(result.bytes), report: result.report };
}
