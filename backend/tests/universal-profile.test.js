import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeAi } from './helpers/fakeAi.js';
import { sampleResume } from './helpers/fixtures.js';
import { parseResumeWithAi } from '../services/resume-parser.service.js';
import { buildResumeEvidence } from '../services/job-analysis/resume-evidence.js';
import { verifyLockedFields } from '../services/tailoring/content-builder.js';
import { renderPdf, layoutCheck } from '../services/tailoring/resume-renderer.js';
import { extractResumeFromPdf } from '../services/pdf-extraction.service.js';
import { structuredResumeSchema } from '../validators/resume.schema.js';

test('parseResumeWithAi normalizes arbitrary-layout text including certifications into structuredResumeSchema', async () => {
  const ai = createFakeAi();
  ai.respondWith({
    personalInfo: {
      fullName: 'Jordan Lee',
      location: 'Austin, TX',
      phone: '+1-555-0100',
      email: 'jordan@example.com',
      linkedin: 'linkedin.com/in/jordanlee',
      github: 'github.com/jordanlee',
      other: [],
    },
    headline: 'Backend Engineer',
    summary: 'Backend Engineer with 4 years building Node.js microservices.',
    technicalSkills: [{ category: 'Languages', items: ['JavaScript', 'TypeScript'] }],
    experience: [
      {
        company: 'Acme Corp',
        location: 'Austin, TX',
        title: 'Software Engineer',
        startDate: 'Jan 2022',
        endDate: 'Present',
        bullets: ['Built REST APIs serving 50k requests per day.'],
      },
    ],
    projects: [],
    education: [
      {
        institution: 'UT Austin',
        location: 'Austin, TX',
        degree: 'B.S. Computer Science',
        score: '3.8 GPA',
        startDate: '2018',
        endDate: '2022',
      },
    ],
    certifications: [
      {
        name: 'AWS Certified Solutions Architect',
        issuer: 'Amazon Web Services',
        date: '2024',
        credentialId: 'AWS-123',
      },
    ],
    achievements: ['Won internal hackathon 2023'],
  });

  const parsed = await parseResumeWithAi('Jordan Lee\nBackend Engineer\n...', ai);
  assert.equal(structuredResumeSchema.safeParse(parsed).success, true);
  assert.equal(parsed.certifications.length, 1);
  assert.equal(parsed.certifications[0].name, 'AWS Certified Solutions Architect');
  assert.ok(parsed.sectionOrder.some((s) => s.key === 'certifications'));
});

test('buildResumeEvidence includes certifications and verifyLockedFields protects them', () => {
  const withCerts = {
    ...structuredClone(sampleResume),
    certifications: [{ name: 'CKA', issuer: 'CNCF', date: '2024', credentialId: '' }],
    sectionOrder: [...sampleResume.sectionOrder, { key: 'certifications', heading: 'CERTIFICATIONS' }],
  };

  const evidence = buildResumeEvidence(withCerts);
  assert.ok(evidence.byId.has('cert.1'));
  assert.equal(evidence.byId.get('cert.1').text, 'CKA — CNCF — 2024');

  const modified = structuredClone(withCerts);
  modified.certifications[0].name = 'CKAD';
  const problems = verifyLockedFields(withCerts, modified);
  assert.ok(problems.some((p) => p.includes('certifications')));
});

test('renderPdf and extractResumeFromPdf round-trip certifications cleanly in classic-v1', async () => {
  const withCerts = {
    ...structuredClone(sampleResume),
    certifications: [{ name: 'AWS Solutions Architect', issuer: 'AWS', date: '2024', credentialId: '' }],
    sectionOrder: [...sampleResume.sectionOrder, { key: 'certifications', heading: 'CERTIFICATIONS' }],
  };

  const layout = layoutCheck(withCerts);
  assert.ok(layout.pageCount <= 2);

  const { bytes } = await renderPdf(withCerts);
  const extracted = await extractResumeFromPdf(bytes);
  assert.deepEqual(extracted.structuredResumeData.certifications, withCerts.certifications);
});
