import { z } from 'zod';
import { cleanMultiline, JD_MAX_CHARS } from './job-analysis.schema.js';
import { EMPLOYMENT_TYPES, INTERVIEW_RESULTS, ROUND_TYPES, SALARY_PERIODS, SOURCES, STATUSES } from '../models/JobApplication.js';

/* ------------------------------------------------------------------ primitives */

const singleLine = (label, max, { required = false } = {}) => {
  const base = z
    .string({ error: `${label} must be text.` })
    .transform((s) => cleanMultiline(s).replace(/\s+/g, ' '))
    .pipe(z.string().max(max, `${label} must be at most ${max} characters.`));
  return required ? base.pipe(z.string().min(1, `${label} is required.`)) : base;
};
const multiline = (label, max) =>
  z
    .string({ error: `${label} must be text.` })
    .transform(cleanMultiline)
    .pipe(z.string().max(max, `${label} must be at most ${max.toLocaleString('en-US')} characters.`));

/** Calendar date "YYYY-MM-DD" → Date at UTC midnight (never shifts between time zones). */
export const dateOnly = (label) =>
  z
    .string({ error: `${label} must be a date (YYYY-MM-DD).` })
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be a date (YYYY-MM-DD).`)
    .transform((s, ctx) => {
      const d = new Date(`${s}T00:00:00.000Z`);
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
        ctx.addIssue({ code: 'custom', message: `${label} is not a valid date.` });
        return z.NEVER;
      }
      if (d.getUTCFullYear() < 1990 || d.getUTCFullYear() > 2100) {
        ctx.addIssue({ code: 'custom', message: `${label} is out of range.` });
        return z.NEVER;
      }
      return d;
    });

/** Exact moment (ISO 8601 with time zone offset). */
const instant = (label) =>
  z
    .string({ error: `${label} must be a date and time.` })
    .refine((s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(s) && !Number.isNaN(Date.parse(s)), `${label} must be an ISO date and time with a time zone.`)
    .transform((s) => new Date(s))
    .refine((d) => d.getUTCFullYear() >= 1990 && d.getUTCFullYear() <= 2100, `${label} is out of range.`);

/** http(s) URL only (no javascript:, data:, file: …). Empty string clears it. */
const webUrl = (label) =>
  z
    .string({ error: `${label} must be text.` })
    .trim()
    .max(2048, `${label} is too long.`)
    .refine((s) => {
      if (s === '') return true;
      try {
        const u = new URL(s);
        return (u.protocol === 'https:' || u.protocol === 'http:') && Boolean(u.hostname);
      } catch {
        return false;
      }
    }, `${label} must be a web address starting with http:// or https://.`);

export const objectId = (label) => z.string({ error: `${label} is required.` }).regex(/^[a-f0-9]{24}$/i, `${label} is not a valid id.`);
const revision = z.number({ error: 'expectedRevision is required.' }).int().min(0);
const money = z.number().finite().min(0, 'Salary cannot be negative.').max(1_000_000_000, 'Salary is too large.');
const years = z.number().finite().min(0).max(60);

/* ------------------------------------------------------------------ application fields */

const fieldShape = {
  companyName: singleLine('Company name', 120, { required: true }),
  jobTitle: singleLine('Job title', 150, { required: true }),
  location: singleLine('Location', 150),
  employmentType: z.enum(EMPLOYMENT_TYPES).nullable(),
  salary: z
    .strictObject({
      min: money.nullable().default(null),
      max: money.nullable().default(null),
      currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter code (e.g. INR, USD).').nullable().default(null),
      period: z.enum(SALARY_PERIODS).nullable().default(null),
    })
    .refine((s) => s.min === null || s.max === null || s.min <= s.max, { message: 'Minimum salary cannot exceed the maximum.', path: ['min'] }),
  experience: z
    .strictObject({
      minYears: years.nullable().default(null),
      maxYears: years.nullable().default(null),
      text: singleLine('Experience', 200).default(''),
    })
    .refine((e) => e.minYears === null || e.maxYears === null || e.minYears <= e.maxYears, { message: 'Minimum years cannot exceed the maximum.', path: ['minYears'] }),
  source: z.enum(SOURCES).nullable(),
  sourceDetail: singleLine('Source detail', 150),
  jobUrl: webUrl('Job URL'),
  jobDescription: multiline('Job description', JD_MAX_CHARS),
  applicationDate: dateOnly('Application date').nullable(),
  notes: multiline('Notes', 5000),
};

const optionalFields = Object.fromEntries(Object.entries(fieldShape).map(([k, v]) => [k, v.optional()]));

export const createApplicationSchema = z.strictObject({
  ...optionalFields,
  companyName: fieldShape.companyName.optional(), // may come from the linked analysis
  jobTitle: fieldShape.jobTitle.optional(),
  status: z.enum(['saved', 'applied']).optional(), // new applications start in Saved or Applied
  jobAnalysisId: objectId('jobAnalysisId').optional(),
  tailoredResumeId: objectId('tailoredResumeId').optional(),
});

export const updateApplicationSchema = z
  .strictObject({ ...optionalFields, expectedRevision: revision })
  .refine((b) => Object.keys(b).some((k) => k !== 'expectedRevision'), 'Nothing to update.');

/* ------------------------------------------------------------------ status, links */

export const statusChangeSchema = z.strictObject({
  status: z.enum(STATUSES),
  note: singleLine('Note', 500).optional(),
  expectedRevision: revision,
});

export const revisionSchema = z.strictObject({ expectedRevision: revision });

export const linksSchema = z.strictObject({
  jobAnalysisId: objectId('jobAnalysisId').nullable(),
  tailoredResumeId: objectId('tailoredResumeId').nullable(),
  expectedRevision: revision,
});

/* ------------------------------------------------------------------ interviews, follow-ups */

const interviewFields = {
  roundType: z.enum(ROUND_TYPES),
  durationMinutes: z.number().int().min(5).max(600).nullable(),
  interviewer: singleLine('Interviewer', 200),
  meetingLink: webUrl('Meeting link'),
  notes: multiline('Notes', 5000),
  feedback: multiline('Feedback', 5000),
  result: z.enum(INTERVIEW_RESULTS),
};

export const createInterviewSchema = z.strictObject({
  ...Object.fromEntries(Object.entries(interviewFields).map(([k, v]) => [k, v.optional()])),
  roundType: interviewFields.roundType,
  scheduledAt: instant('Interview date and time'),
  expectedRevision: revision,
});

export const updateInterviewSchema = z
  .strictObject({
    ...Object.fromEntries(Object.entries(interviewFields).map(([k, v]) => [k, v.optional()])),
    completed: z.literal(true).optional(), // mark a scheduled round as held
    expectedRevision: revision,
  })
  .refine((b) => Object.keys(b).some((k) => k !== 'expectedRevision'), 'Nothing to update.');

export const rescheduleSchema = z.strictObject({
  scheduledAt: instant('New date and time'),
  reason: singleLine('Reason', 500).optional(),
  expectedRevision: revision,
});

export const cancelInterviewSchema = z.strictObject({
  reason: singleLine('Reason', 500).optional(),
  expectedRevision: revision,
});

export const createFollowUpSchema = z.strictObject({
  dueDate: dateOnly('Follow-up date'),
  note: multiline('Note', 1000).optional(),
  expectedRevision: revision,
});

export const updateFollowUpSchema = z
  .strictObject({
    dueDate: dateOnly('Follow-up date').optional(),
    note: multiline('Note', 1000).optional(),
    status: z.enum(['pending', 'completed']).optional(),
    expectedRevision: revision,
  })
  .refine((b) => Object.keys(b).some((k) => k !== 'expectedRevision'), 'Nothing to update.');

/* ------------------------------------------------------------------ queries */

const SORTS = ['applicationDate', 'updatedAt', 'createdAt', 'companyName', 'jobTitle'];
const asArray = (v) => (v === undefined ? undefined : Array.isArray(v) ? v : String(v).split(','));

/** Valid IANA time zone, else UTC. */
export const timeZone = z
  .string()
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  })
  .catch('UTC');

export const listQuerySchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  status: z.preprocess(asArray, z.array(z.enum(STATUSES)).max(6)).optional(),
  location: z.string().trim().max(150).optional().catch(undefined),
  source: z.enum(SOURCES).optional(),
  from: dateOnly('from').optional(),
  to: dateOnly('to').optional(),
  sort: z.enum(SORTS).catch('updatedAt'),
  order: z.enum(['asc', 'desc']).catch('desc'),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
  limit: z.coerce.number().int().min(1).max(50).catch(20),
});

export const dashboardQuerySchema = z.object({ tz: timeZone.default('UTC') });
