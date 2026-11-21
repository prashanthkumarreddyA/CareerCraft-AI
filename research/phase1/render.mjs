// Render structured resume JSON to PDF using the measured template.
// usage: node render.mjs <resume.json> <out.pdf> [--calibri]
//   default fonts: Latin subsets of Carlito (OFL, metric-compatible with Calibri) from ./fonts
//   --calibri:     use the locally installed Windows Calibri (local comparison only; not redistributable)
import fs from 'node:fs/promises';
import path from 'node:path';
import * as pdfLib from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { renderResumePdf } from './resume-template.mjs';

const [, , input, output, flag] = process.argv;
if (!input || !output) {
  console.error('usage: node render.mjs <resume.json> <out.pdf> [--calibri]');
  process.exit(1);
}

const fontFiles =
  flag === '--calibri'
    ? { regular: 'C:/Windows/Fonts/calibri.ttf', bold: 'C:/Windows/Fonts/calibrib.ttf', italic: 'C:/Windows/Fonts/calibrii.ttf', boldItalic: 'C:/Windows/Fonts/calibriz.ttf' }
    : Object.fromEntries(
        Object.entries({ regular: 'Regular', bold: 'Bold', italic: 'Italic', boldItalic: 'BoldItalic' }).map(([k, v]) => [k, path.join('fonts', `Carlito-${v}.latin.ttf`)]),
      );

const fontBytes = {};
for (const [k, f] of Object.entries(fontFiles)) fontBytes[k] = await fs.readFile(f);

const resume = JSON.parse(await fs.readFile(input, 'utf8'));
const started = performance.now();
const { bytes, report } = await renderResumePdf(resume, { pdfLib, fontkit, fontBytes });
await fs.writeFile(output, bytes);
console.log(
  `Rendered ${output}: ${report.pageCount} page(s), last page ${Math.round(report.lastPageFill * 100)}% full, ` +
    `${(bytes.length / 1024).toFixed(0)} KB, ${(performance.now() - started).toFixed(0)} ms`,
);
