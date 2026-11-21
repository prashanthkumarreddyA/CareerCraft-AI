// Phase 1 extractor: reads the master resume PDF with pdf.js and produces
//   1. structured resume JSON (content only)
//   2. a line-level dump (text, style runs, coordinates) used for template measurement
//
// Classification relies on the typography of the original template:
//   - section headings: bold, 12pt, uppercase
//   - entry headers:    line starting with a bold run (company / project / institution)
//   - role/degree line: line starting with an italic run
//   - bullets:          line starting with "•"
//   - continuations:    anything else that follows at the normal line pitch
import fs from 'node:fs/promises';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const [, , inputPath, jsonOut, linesOut] = process.argv;
if (!inputPath || !jsonOut) {
  console.error('usage: node extract.mjs <input.pdf> <resume.json> [lines.json]');
  process.exit(1);
}

const BULLET = '•';
const LINE_TOLERANCE = 1.0; // pt: items within this baseline distance belong to one line
const PARAGRAPH_GAP = 15.0; // pt: baseline gaps above this start a new paragraph

function styleFromFontName(name = '') {
  const n = name.toLowerCase();
  return { bold: n.includes('bold'), italic: n.includes('italic') || n.includes('oblique') };
}

async function readLines(pdf) {
  const fonts = new Map();
  const lines = [];
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const [, , width, height] = page.view;
    pages.push({ number: p, width, height });
    await page.getOperatorList(); // forces font objects into commonObjs so real names are available
    const content = await page.getTextContent();

    const items = [];
    for (const item of content.items) {
      if (!item.str) continue;
      let realName = fonts.get(item.fontName);
      if (!realName) {
        try {
          realName = page.commonObjs.get(item.fontName)?.name ?? item.fontName;
        } catch {
          realName = item.fontName;
        }
        fonts.set(item.fontName, realName);
      }
      const [a, b, , , x, y] = item.transform;
      items.push({
        text: item.str,
        x,
        baseline: height - y,
        width: item.width,
        size: Math.round(Math.hypot(a, b) * 100) / 100,
        font: realName.replace(/^[A-Z]{6}\+/, ''),
        ...styleFromFontName(realName),
      });
    }

    items.sort((m, n) => m.baseline - n.baseline || m.x - n.x);
    for (const item of items) {
      const last = lines[lines.length - 1];
      if (last && last.page === p && Math.abs(last.baseline - item.baseline) <= LINE_TOLERANCE) {
        last.items.push(item);
      } else {
        lines.push({ page: p, baseline: item.baseline, items: [item] });
      }
    }
  }

  for (const line of lines) {
    line.items.sort((m, n) => m.x - n.x);
    line.runs = [];
    for (const item of line.items) {
      const isBlank = item.text.trim() === '';
      const prev = line.runs[line.runs.length - 1];
      // whitespace-only items (e.g. a stray Times New Roman space) inherit the previous style
      if (prev && (isBlank || (prev.bold === item.bold && prev.italic === item.italic))) {
        prev.text += item.text;
      } else {
        line.runs.push({ text: item.text, bold: item.bold, italic: item.italic });
      }
    }
    line.x = line.items[0].x;
    line.size = Math.max(...line.items.filter((i) => i.text.trim()).map((i) => i.size));
    line.text = line.runs.map((r) => r.text).join('').replace(/\s+/g, ' ').trim();
    line.firstRun = line.runs.find((r) => r.text.trim()) ?? line.runs[0];
    delete line.items;
  }
  return { lines, pages, fonts: [...new Set([...fonts.values()].map((f) => f.replace(/^[A-Z]{6}\+/, '')))] };
}

const isHeading = (l) => l.firstRun.bold && l.size >= 11.5 && l.size <= 14 && l.text === l.text.toUpperCase() && l.runs.length === 1;
const startsBullet = (l) => l.text.startsWith(BULLET);
const startsBold = (l) => l.firstRun.bold && !startsBullet(l);
const startsItalic = (l) => l.firstRun.italic;

// Merge physical lines into logical paragraphs, keeping style runs.
function toParagraphs(lines) {
  const paragraphs = [];
  let prev = null;
  for (const line of lines) {
    const gap = prev && prev.page === line.page ? line.baseline - prev.baseline : 0;
    const startsNew =
      !paragraphs.length || isHeading(line) || isHeading(prev) || startsBullet(line) || startsBold(line) ||
      startsItalic(line) || gap > PARAGRAPH_GAP || Math.abs(line.size - prev.size) > 0.1;
    if (startsNew) {
      paragraphs.push({ lines: [line], runs: line.runs.map((r) => ({ ...r })) });
    } else {
      const para = paragraphs[paragraphs.length - 1];
      para.lines.push(line);
      const lastRun = para.runs[para.runs.length - 1];
      lastRun.text = lastRun.text.replace(/\s*$/, ' ');
      for (const r of line.runs) {
        const tail = para.runs[para.runs.length - 1];
        if (tail.bold === r.bold && tail.italic === r.italic) tail.text += r.text;
        else para.runs.push({ ...r });
      }
    }
    prev = line;
  }
  for (const p of paragraphs) {
    p.runs = p.runs.map((r) => ({ ...r, text: r.text.replace(/\s+/g, ' ') })).filter((r) => r.text !== '');
    p.text = p.runs.map((r) => r.text).join('').trim();
    p.first = p.lines[0];
  }
  return paragraphs;
}

// Split a comma-separated list, ignoring commas inside parentheses.
function splitList(text) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const stripBullet = (t) => t.replace(new RegExp(`^${BULLET}\\s*`), '').trim();
// Returns the leading run(s) with the given style (bold/italic) and the remaining text.
const leadingStyled = (p, key) => {
  let i = 0;
  let lead = '';
  while (i < p.runs.length && p.runs[i][key]) lead += p.runs[i++].text;
  const rest = p.runs.slice(i).map((r) => r.text).join('');
  return { lead: lead.trim(), rest: rest.trim() };
};
const splitDates = (s) => {
  const [start, end] = s.split(/\s*[–-]\s*/);
  return { startDate: (start ?? '').trim(), endDate: (end ?? '').trim() };
};

const SECTION_KEYS = {
  SUMMARY: 'summary',
  'PROFESSIONAL SUMMARY': 'summary',
  'TECHNICAL SKILLS': 'technicalSkills',
  SKILLS: 'technicalSkills',
  'PROFESSIONAL EXPERIENCE': 'experience',
  EXPERIENCE: 'experience',
  'WORK EXPERIENCE': 'experience',
  PROJECTS: 'projects',
  EDUCATION: 'education',
  ACHIEVEMENTS: 'achievements',
};

function parseHeader(paragraphs) {
  const [nameP, ...rest] = paragraphs;
  const contactLines = [];
  let headline = '';
  for (const p of rest) {
    for (const line of p.lines) {
      if (line.firstRun.bold) headline = line.text;
      else contactLines.push(line.text);
    }
  }
  const tokens = contactLines.flatMap((l) => l.split('|').map((t) => t.trim()).filter(Boolean));
  const personalInfo = { fullName: nameP.text, location: '', phone: '', email: '', linkedin: '', github: '', other: [] };
  for (const t of tokens) {
    if (/@/.test(t)) personalInfo.email = t;
    else if (/linkedin\.com/i.test(t)) personalInfo.linkedin = t;
    else if (/github\.com/i.test(t)) personalInfo.github = t;
    else if (/^\+?[\d\s()-]{8,}$/.test(t)) personalInfo.phone = t;
    else if (!personalInfo.location) personalInfo.location = t;
    else personalInfo.other.push(t);
  }
  return { personalInfo, headline };
}

function parseEntries(paragraphs, kind) {
  const entries = [];
  for (const p of paragraphs) {
    const cur = entries[entries.length - 1];
    if (startsBullet(p.first)) {
      if (!cur) throw new Error(`Bullet before any ${kind} entry: "${p.text}"`);
      cur.bullets.push(stripBullet(p.text));
    } else if (startsBold(p.first)) {
      const { lead, rest } = leadingStyled(p, 'bold');
      if (kind === 'projects') {
        entries.push({ name: lead, technologies: splitList(rest.replace(/^\|\s*/, '')), bullets: [] });
      } else {
        const location = rest.replace(/^[—–-]\s*/, '');
        entries.push(kind === 'education' ? { institution: lead, location } : { company: lead, location, bullets: [] });
      }
    } else if (startsItalic(p.first)) {
      if (!cur) throw new Error(`Role line before any ${kind} entry: "${p.text}"`);
      const { lead, rest } = leadingStyled(p, 'italic');
      const dates = splitDates(rest.replace(/^\|\s*/, ''));
      if (kind === 'education') {
        const [degree, ...detail] = lead.split(/;\s*/);
        Object.assign(cur, { degree: degree.trim(), score: detail.join('; ').trim(), ...dates });
      } else {
        Object.assign(cur, { title: lead, ...dates });
      }
    } else {
      throw new Error(`Unrecognised paragraph in ${kind}: "${p.text}"`);
    }
  }
  // keep a stable key order for readability
  if (kind === 'experience') return entries.map(({ company, location, title, startDate, endDate, bullets }) => ({ company, location, title, startDate, endDate, bullets }));
  if (kind === 'education') return entries.map(({ institution, location, degree, score, startDate, endDate }) => ({ institution, location, degree, score, startDate, endDate }));
  return entries;
}

function parseResume(paragraphs) {
  const sections = [];
  let current = { heading: null, paragraphs: [] };
  for (const p of paragraphs) {
    if (isHeading(p.first)) {
      sections.push(current);
      current = { heading: p.text, paragraphs: [] };
    } else current.paragraphs.push(p);
  }
  sections.push(current);

  const [headerSection, ...bodySections] = sections;
  const resume = { ...parseHeader(headerSection.paragraphs), summary: '', technicalSkills: [], experience: [], projects: [], education: [], achievements: [] };
  const sectionOrder = [];
  const unknownSections = [];

  for (const s of bodySections) {
    const key = SECTION_KEYS[s.heading];
    if (!key) {
      unknownSections.push({ heading: s.heading, paragraphs: s.paragraphs.map((p) => p.text) });
      continue;
    }
    sectionOrder.push({ key, heading: s.heading });
    if (key === 'summary') resume.summary = s.paragraphs.map((p) => p.text).join(' ');
    else if (key === 'technicalSkills') {
      resume.technicalSkills = s.paragraphs.map((p) => {
        const body = stripBullet(p.text);
        const { lead } = leadingStyled({ runs: p.runs.filter((r) => r.text.trim() !== BULLET) }, 'bold');
        const category = lead.replace(/:$/, '').replace(new RegExp(`^${BULLET}\\s*`), '').trim();
        return { category, items: splitList(body.slice(body.indexOf(':') + 1)) };
      });
    } else if (key === 'achievements') resume.achievements = s.paragraphs.map((p) => stripBullet(p.text));
    else resume[key] = parseEntries(s.paragraphs, key);
  }
  return { resume, sectionOrder, unknownSections };
}

const data = new Uint8Array(await fs.readFile(inputPath));
const pdf = await pdfjs.getDocument({ data, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
const { lines, pages, fonts } = await readLines(pdf);

if (!lines.length) {
  console.error('No extractable text: the PDF is probably scanned or image-only.');
  process.exit(2);
}

const paragraphs = toParagraphs(lines);
const { resume, sectionOrder, unknownSections } = parseResume(paragraphs);

const output = {
  ...resume,
  sectionOrder,
  ...(unknownSections.length ? { unknownSections } : {}),
  source: {
    pageCount: pages.length,
    pageSize: { width: pages[0].width, height: pages[0].height },
    fonts,
    fontSizes: [...new Set(lines.map((l) => l.size))].sort((a, b) => a - b),
  },
};

await fs.writeFile(jsonOut, JSON.stringify(output, null, 2) + '\n');
if (linesOut) {
  const slim = lines.map(({ page, baseline, x, size, text, runs }) => ({
    page,
    baseline: +baseline.toFixed(2),
    x: +x.toFixed(2),
    size,
    text,
    runs: runs.map((r) => ({ text: r.text, ...(r.bold ? { bold: true } : {}), ...(r.italic ? { italic: true } : {}) })),
  }));
  await fs.writeFile(linesOut, JSON.stringify(slim, null, 2) + '\n');
}
console.log(`Extracted ${lines.length} lines, ${paragraphs.length} paragraphs, ${sectionOrder.length} sections from ${pages.length} page(s).`);
console.log('Fonts:', fonts.join(', '));
if (unknownSections.length) console.warn('Unrecognised sections:', unknownSections.map((s) => s.heading).join(', '));
