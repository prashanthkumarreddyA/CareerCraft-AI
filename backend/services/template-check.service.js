// Checks an extracted PDF against the measured Phase 1 template ("classic-v1",
// research/phase1/output/template-metadata.json). A compatible resume can later be
// regenerated in its original layout; an incompatible one is still stored, but flagged.

export const SUPPORTED_TEMPLATE_ID = 'classic-v1';

const TEMPLATE = {
  pageSize: { width: 612, height: 792 }, // US Letter
  fontFamilies: ['calibri', 'carlito'], // Carlito is the metric-compatible open font
  fontSizes: [10.5, 12, 18], // body, section heading, name
  requiredSections: ['summary', 'technicalSkills', 'experience', 'education'],
};

/**
 * @returns {{ templateId: string|null, compatible: boolean, issues: string[] }}
 * Issues are descriptive and contain no resume content.
 */
export function checkTemplateCompatibility({ structuredResumeData, extractedContent, unknownSections = [] }) {
  const issues = [];
  const { pageSize, fonts, fontSizes } = extractedContent;

  if (Math.abs(pageSize.width - TEMPLATE.pageSize.width) > 1 || Math.abs(pageSize.height - TEMPLATE.pageSize.height) > 1) {
    issues.push(`Page size is ${Math.round(pageSize.width)}×${Math.round(pageSize.height)} pt; the template expects US Letter (612×792 pt).`);
  }
  const textFonts = fonts.filter((f) => !/times/i.test(f)); // Word sometimes emits a stray Times space
  const foreign = textFonts.filter((f) => !TEMPLATE.fontFamilies.some((family) => f.toLowerCase().includes(family)));
  if (foreign.length) issues.push(`Uses fonts outside the template (${foreign.join(', ')}).`);

  const missingSizes = TEMPLATE.fontSizes.filter((s) => !fontSizes.includes(s));
  if (missingSizes.length) issues.push(`Font sizes differ from the template (missing ${missingSizes.join(', ')} pt).`);

  const present = new Set(structuredResumeData.sectionOrder.map((s) => s.key));
  const missingSections = TEMPLATE.requiredSections.filter((s) => !present.has(s));
  if (missingSections.length) issues.push(`Sections not found: ${missingSections.join(', ')}.`);
  if (unknownSections.length) issues.push(`Unrecognised section headings: ${unknownSections.map((s) => s.heading).join(', ')}.`);

  const compatible = issues.length === 0;
  return { templateId: compatible ? SUPPORTED_TEMPLATE_ID : null, compatible, issues };
}
