import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractResumeFromPdf, ExtractionError } from '../services/pdf-extraction.service.js';
import { checkTemplateCompatibility } from '../services/template-check.service.js';
import { structuredResumeSchema } from '../validators/resume.schema.js';
import { sampleResume, samplePdf, blankPdf, corruptedPdf, unstructuredPdf, realResumePaths } from './helpers/fixtures.js';

test('sample resume round-trips: rendered with the template, extracted back identically', async () => {
  const result = await extractResumeFromPdf(await samplePdf());
  assert.deepEqual(result.structuredResumeData, sampleResume);
  assert.ok(structuredResumeSchema.safeParse(result.structuredResumeData).success);
  const compat = checkTemplateCompatibility(result);
  assert.deepEqual(compat, { templateId: 'classic-v1', compatible: true, issues: [] });
  assert.equal(result.extractedContent.pageSize.width, 612);
  assert.ok(result.extractedContent.lines.every((l) => typeof l.baseline === 'number' && Array.isArray(l.runs)));
});

const realAvailable = fs.existsSync(realResumePaths.pdf) && fs.existsSync(realResumePaths.baselineJson);
test(
  'real master resume matches the Phase 1 baseline exactly (local only: personal files are git-ignored)',
  { skip: !realAvailable && 'original-resume.pdf / Phase 1 output not present' },
  async () => {
    const result = await extractResumeFromPdf(fs.readFileSync(realResumePaths.pdf));
    const { source, ...baseline } = JSON.parse(fs.readFileSync(realResumePaths.baselineJson, 'utf8'));
    assert.deepEqual(result.structuredResumeData, baseline);
    assert.deepEqual(result.extractedContent.lines, JSON.parse(fs.readFileSync(realResumePaths.baselineLines, 'utf8')));
    assert.equal(result.extractedContent.pageCount, source.pageCount);
    assert.deepEqual(result.extractedContent.fonts, source.fonts);
    assert.deepEqual(result.extractedContent.fontSizes, source.fontSizes);
    assert.equal(checkTemplateCompatibility(result).templateId, 'classic-v1');
  },
);

test('image-only PDF is rejected as NO_TEXT', async () => {
  await assert.rejects(extractResumeFromPdf(await blankPdf()), (err) => err instanceof ExtractionError && err.code === 'NO_TEXT');
});

test('corrupted PDF is rejected as INVALID_PDF', async () => {
  await assert.rejects(extractResumeFromPdf(corruptedPdf()), (err) => err instanceof ExtractionError && err.code === 'INVALID_PDF');
});

test('non-resume PDF is flagged: no recognised sections', async () => {
  const result = await extractResumeFromPdf(await unstructuredPdf());
  assert.equal(result.structuredResumeData.sectionOrder.length, 0);
  assert.equal(structuredResumeSchema.safeParse(result.structuredResumeData).success, false);
});
