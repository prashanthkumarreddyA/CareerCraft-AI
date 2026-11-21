// Template specification measured from the original Word-exported PDF
// (the master resume, research/phase1/original-resume.pdf). All units are PDF points (1/72 in),
// y measured from the top of the page.
//
// How the spacing model works (mirrors Word's paragraph model):
//   line height        = size * (ascent + descent)           (Calibri/Carlito: 1.2207 em)
//   first baseline     = paragraph top + size * ascent
//   next paragraph top = prev bottom + max(prev.spaceAfter, next.spaceBefore) + prev.borderExtra
//   a line fits if     baseline + size * descent <= page height - bottom margin
//   space before is suppressed for the first paragraph on a page.
export const RESUME_TEMPLATE = {
  id: 'classic-v1',
  page: { width: 612, height: 792 }, // US Letter
  margin: { top: 72, right: 72, bottom: 72, left: 72 }, // 1 inch
  fontMetrics: { ascent: 1950 / 2048, descent: 550 / 2048 }, // OS/2 winAscent / winDescent
  color: { r: 0, g: 0, b: 0 },
  contactLayout: [['location', 'phone', 'email'], ['linkedin', 'github', 'other']],
  separators: { contact: ' | ', location: ' — ', role: ' | ', dateRange: ' – ', list: ', ', score: '; ' },
  bullet: '• ',
  styles: {
    name: { size: 18, bold: true, align: 'center' },
    contact: { size: 10.5, align: 'center' },
    headline: { size: 10.5, bold: true, align: 'center', spaceBefore: 4 },
    heading: {
      size: 12,
      bold: true,
      spaceBefore: 10,
      spaceAfter: 3.85,
      borderExtra: 0.75,
      keepWithNext: true,
      rule: { offsetBelowBaseline: 3.0, thickness: 0.75, x0: 70.525, x1: 541.725 },
    },
    body: { size: 10.5 },
    bullet: { size: 10.5, indent: 12 },
    entryHeader: { size: 10.5, spaceBefore: 6, keepWithNext: true },
    entrySub: { size: 10.5, keepWithNext: true },
  },
};

const HYPHEN_BREAK = /(?<=[A-Za-z]-)(?=[A-Za-z])/;

/**
 * Build the paragraph list for a resume in template order.
 * Each paragraph: { style, runs: [{ text, bold?, italic? }], rule? }
 */
export function buildParagraphs(resume, t = RESUME_TEMPLATE) {
  const sep = t.separators;
  const p = (style, runs) => ({ style, runs: runs.filter((r) => r.text) });
  const out = [];
  const info = resume.personalInfo;

  out.push(p('name', [{ text: info.fullName, bold: true }]));
  for (const fields of t.contactLayout) {
    const parts = fields.flatMap((f) => (Array.isArray(info[f]) ? info[f] : [info[f]])).filter(Boolean);
    if (parts.length) out.push(p('contact', [{ text: parts.join(sep.contact) }]));
  }
  if (resume.headline) out.push(p('headline', [{ text: resume.headline, bold: true }]));

  const bullet = (text) => p('bullet', [{ text: t.bullet + text }]);
  const dates = (e) => [e.startDate, e.endDate].filter(Boolean).join(sep.dateRange);

  for (const { key, heading } of resume.sectionOrder) {
    const body = [];
    if (key === 'summary' && resume.summary) body.push(p('body', [{ text: resume.summary }]));
    if (key === 'technicalSkills') {
      for (const s of resume.technicalSkills) {
        if (!s.items?.length) continue;
        body.push(p('bullet', [{ text: t.bullet }, { text: `${s.category}: `, bold: true }, { text: s.items.join(sep.list) }]));
      }
    }
    if (key === 'experience') {
      for (const e of resume.experience) {
        body.push(p('entryHeader', [{ text: e.company, bold: true }, { text: e.location ? sep.location + e.location : '' }]));
        body.push(p('entrySub', [{ text: e.title, italic: true }, { text: dates(e) ? sep.role + dates(e) : '' }]));
        body.push(...e.bullets.map(bullet));
      }
    }
    if (key === 'projects') {
      for (const pr of resume.projects) {
        const tech = pr.technologies?.length ? sep.role + pr.technologies.join(sep.list) : '';
        body.push(p('entryHeader', [{ text: pr.name, bold: true }, { text: tech }]));
        body.push(...pr.bullets.map(bullet));
      }
    }
    if (key === 'education') {
      for (const ed of resume.education) {
        body.push(p('entryHeader', [{ text: ed.institution, bold: true }, { text: ed.location ? sep.location + ed.location : '' }]));
        const degree = ed.score ? ed.degree + sep.score + ed.score : ed.degree;
        body.push(p('entrySub', [{ text: degree, italic: true }, { text: dates(ed) ? sep.role + dates(ed) : '' }]));
      }
    }
    if (key === 'achievements') body.push(...resume.achievements.map(bullet));

    if (body.length) out.push(p('heading', [{ text: heading, bold: true }]), ...body);
  }
  return out;
}

// --- line breaking -----------------------------------------------------------

function fontFor(fonts, run, style) {
  const bold = run.bold || style.bold;
  const italic = run.italic || style.italic;
  if (bold && italic) return fonts.boldItalic;
  if (bold) return fonts.bold;
  if (italic) return fonts.italic;
  return fonts.regular;
}

// Words are the unbreakable units; breaks are allowed at spaces and after an
// in-word hyphen (Word's default behaviour, no automatic hyphenation).
function toWords(runs, style, fonts) {
  const words = [];
  let current = null;
  const flush = () => {
    if (current?.pieces.length) words.push(current);
    current = null;
  };
  for (const run of runs) {
    const font = fontFor(fonts, run, style);
    for (const part of run.text.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        if (current) current.spaceWidth = font.widthOfTextAtSize(' ', style.size);
        else if (words.length) words[words.length - 1].spaceWidth = font.widthOfTextAtSize(' ', style.size);
        flush();
        continue;
      }
      const chunks = part.split(HYPHEN_BREAK);
      chunks.forEach((chunk, i) => {
        current ??= { pieces: [], width: 0, spaceWidth: 0 };
        const w = font.widthOfTextAtSize(chunk, style.size);
        current.pieces.push({ text: chunk, font, width: w });
        current.width += w;
        if (i < chunks.length - 1) flush(); // break opportunity after hyphen, no space
      });
    }
  }
  flush();
  return words;
}

function wrap(words, maxWidth) {
  const lines = [];
  let line = [];
  let width = 0;
  for (const word of words) {
    const prev = line[line.length - 1];
    const candidate = line.length ? width + prev.spaceWidth + word.width : word.width;
    if (line.length && candidate > maxWidth + 0.01) {
      lines.push(line);
      line = [word];
      width = word.width;
    } else {
      line.push(word);
      width = candidate;
    }
  }
  if (line.length) lines.push(line);
  return lines.map((ws) => {
    const pieces = [];
    ws.forEach((w, i) => {
      pieces.push(...w.pieces);
      if (i < ws.length - 1 && w.spaceWidth) pieces.push({ text: ' ', font: w.pieces[w.pieces.length - 1].font, width: w.spaceWidth });
    });
    return { pieces, width: pieces.reduce((s, x) => s + x.width, 0) };
  });
}

// --- page layout -------------------------------------------------------------

/**
 * Lay out paragraphs onto pages. Returns positioned lines and rules, without
 * touching a PDF, so the same result can drive the PDF writer and validation.
 */
export function layoutResume(paragraphs, fonts, t = RESUME_TEMPLATE) {
  const { ascent, descent } = t.fontMetrics;
  const contentLeft = t.margin.left;
  const contentRight = t.page.width - t.margin.right;
  const bottomLimit = t.page.height - t.margin.bottom + 0.01;

  const prepared = paragraphs.map((para) => {
    const style = { spaceBefore: 0, spaceAfter: 0, borderExtra: 0, indent: 0, align: 'left', ...t.styles[para.style] };
    const x0 = contentLeft + style.indent;
    const lines = wrap(toWords(para.runs, style, fonts), contentRight - x0);
    return { ...para, style, x0, lines, lineHeight: style.size * (ascent + descent) };
  });

  const pages = [{ lines: [], rules: [] }];
  let prevBottom = null; // bottom of previous paragraph on the current page (null = top of page)
  let prevStyle = null;

  const topFor = (style) =>
    prevBottom === null ? t.margin.top : prevBottom + Math.max(prevStyle.spaceAfter, style.spaceBefore) + prevStyle.borderExtra;
  const fits = (baseline, size) => baseline + size * descent <= bottomLimit;
  const newPage = () => {
    pages.push({ lines: [], rules: [] });
    prevBottom = null;
    prevStyle = null;
  };

  // Height (as last baseline) needed to place paragraphs [i..] chained by keepWithNext plus the
  // first line of the paragraph that follows the chain, starting from the current position.
  const chainFits = (i) => {
    let bottom = prevBottom;
    let pStyle = prevStyle;
    for (let j = i; j < prepared.length; j++) {
      const para = prepared[j];
      const top = bottom === null ? t.margin.top : bottom + Math.max(pStyle.spaceAfter, para.style.spaceBefore) + pStyle.borderExtra;
      const isLast = !para.style.keepWithNext;
      const count = isLast ? 1 : para.lines.length;
      const lastBaseline = top + para.style.size * ascent + (count - 1) * para.lineHeight;
      if (!fits(lastBaseline, para.style.size)) return false;
      if (isLast) return true;
      bottom = lastBaseline + para.style.size * descent;
      pStyle = para.style;
    }
    return true;
  };

  prepared.forEach((para, i) => {
    const { style, lines, lineHeight } = para;
    if (style.keepWithNext && prevBottom !== null && !chainFits(i)) newPage();

    const n = lines.length;
    let start = 0;
    let baseline = 0;
    while (start < n) {
      baseline = topFor(style) + style.size * ascent; // topFor() suppresses space before at page top
      let k = 0;
      while (start + k < n && fits(baseline + k * lineHeight, style.size)) k++;
      const remaining = n - start - k;
      if (remaining > 0) {
        if (prevBottom === null) {
          k = Math.max(k, 1); // empty page: must place something
        } else {
          // widow/orphan control: never leave a single line of a paragraph on either page
          if (remaining === 1) k -= 1;
          if (k < 2) k = 0;
        }
      }
      if (k === 0) {
        newPage();
        continue;
      }
      const page = pages[pages.length - 1];
      for (let j = 0; j < k; j++) {
        const line = lines[start + j];
        const x = style.align === 'center' ? contentLeft + (contentRight - contentLeft - line.width) / 2 : para.x0;
        page.lines.push({ baseline, x, width: line.width, size: style.size, pieces: line.pieces });
        baseline += lineHeight;
      }
      start += k;
      if (start < n) newPage();
    }

    const lastBaseline = baseline - lineHeight;
    if (style.rule) {
      pages[pages.length - 1].rules.push({
        x0: style.rule.x0,
        x1: style.rule.x1,
        top: lastBaseline + style.rule.offsetBelowBaseline,
        thickness: style.rule.thickness,
      });
    }
    prevBottom = lastBaseline + style.size * descent;
    prevStyle = style;
  });

  return { pages };
}

/**
 * Render a resume to PDF bytes with pdf-lib.
 * @param resume   structured resume JSON
 * @param pdfLib   the pdf-lib module ({ PDFDocument, rgb })
 * @param fontkit  @pdf-lib/fontkit
 * @param fontBytes { regular, bold, italic, boldItalic } TTF bytes (Carlito or Calibri)
 * @param subset    pdf-lib's own subsetter. Off by default: with Carlito/Calibri it drops most
 *                  glyph outlines (text extracts correctly but renders blank). Ship pre-subset
 *                  Latin font files instead to keep PDFs small.
 */
export async function renderResumePdf(resume, { pdfLib, fontkit, fontBytes, template = RESUME_TEMPLATE, metadata = {}, subset = false }) {
  const { PDFDocument, rgb } = pdfLib;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const embedOptions = { subset, features: { liga: false, kern: false, calt: false } };

  // Measure with un-embedded fontkit faces first, then embed only the faces actually used.
  const paragraphs = buildParagraphs(resume, template);
  const fonts = {};
  for (const key of ['regular', 'bold', 'italic', 'boldItalic']) {
    const face = fontkit.create(fontBytes[key]);
    fonts[key] = {
      key,
      widthOfTextAtSize: (text, size) =>
        (face.layout(text, embedOptions.features).glyphs.reduce((w, g) => w + g.advanceWidth, 0) * size) / face.unitsPerEm,
    };
  }
  const layout = layoutResume(paragraphs, fonts, template);
  const used = new Set(layout.pages.flatMap((p) => p.lines.flatMap((l) => l.pieces.map((x) => x.font.key))));
  const embedded = {};
  for (const key of used) embedded[key] = await doc.embedFont(fontBytes[key], embedOptions);
  for (const page of layout.pages) for (const line of page.lines) for (const piece of line.pieces) piece.font = embedded[piece.font.key];

  const color = rgb(template.color.r, template.color.g, template.color.b);
  const H = template.page.height;

  for (const pageLayout of layout.pages) {
    const page = doc.addPage([template.page.width, H]);
    for (const line of pageLayout.lines) {
      // merge adjacent pieces with the same font into one text run
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

  doc.setTitle(metadata.title ?? `${resume.personalInfo.fullName} – Resume`);
  doc.setAuthor(resume.personalInfo.fullName);
  doc.setCreator('AI Resume Builder');
  doc.setProducer('AI Resume Builder (pdf-lib)');

  const report = {
    pageCount: layout.pages.length,
    lastPageFill: (() => {
      const last = layout.pages[layout.pages.length - 1].lines.at(-1);
      const usable = H - template.margin.top - template.margin.bottom;
      return last ? +((last.baseline - template.margin.top) / usable).toFixed(3) : 0;
    })(),
  };
  return { bytes: await doc.save(), report };
}
