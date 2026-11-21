import { z } from 'zod';

// Mirrors the structure of research/phase1/output/master-resume.json (the Phase 1 baseline).
// Strict objects: an unexpected key means the extractor and this contract have drifted.
const text = z.string().max(5000);
const shortText = z.string().max(300);

export const personalInfoSchema = z.strictObject({
  fullName: shortText.min(1, 'Name is missing'),
  location: shortText,
  phone: shortText,
  email: shortText,
  linkedin: shortText,
  github: shortText,
  other: z.array(shortText).max(10),
});

export const skillCategorySchema = z.strictObject({
  category: shortText.min(1),
  items: z.array(shortText.min(1)).min(1).max(60),
});

export const experienceSchema = z.strictObject({
  company: shortText.min(1),
  location: shortText,
  title: shortText,
  startDate: shortText,
  endDate: shortText,
  bullets: z.array(text.min(1)).max(40),
});

export const projectSchema = z.strictObject({
  name: shortText.min(1),
  technologies: z.array(shortText.min(1)).max(40),
  bullets: z.array(text.min(1)).max(40),
});

export const educationSchema = z.strictObject({
  institution: shortText.min(1),
  location: shortText,
  degree: shortText,
  score: shortText,
  startDate: shortText,
  endDate: shortText,
});

export const SECTION_KEY_VALUES = ['summary', 'technicalSkills', 'experience', 'projects', 'education', 'achievements'];

export const structuredResumeSchema = z.strictObject({
  personalInfo: personalInfoSchema,
  headline: shortText,
  summary: text,
  technicalSkills: z.array(skillCategorySchema).max(30),
  experience: z.array(experienceSchema).max(30),
  projects: z.array(projectSchema).max(30),
  education: z.array(educationSchema).max(20),
  achievements: z.array(text.min(1)).max(30),
  sectionOrder: z
    .array(z.strictObject({ key: z.enum(SECTION_KEY_VALUES), heading: shortText.min(1) }))
    .min(1)
    .refine((s) => new Set(s.map((x) => x.key)).size === s.length, 'Duplicate section'),
});

/** Returns a list of human-readable problems (paths only, never values). */
export function describeSchemaIssues(error) {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}
