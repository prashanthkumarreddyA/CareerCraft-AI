import { z } from 'zod';

export const JD_MIN_CHARS = 80;
export const JD_MAX_CHARS = 20_000;

/** Removes control characters (keeps newlines/tabs), normalises line endings and blank-line runs. */
export function cleanMultiline(value) {
  return String(value)
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‍﻿]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const singleLine = (label, max) =>
  z
    .string({ error: `${label} is required.` })
    .transform((s) => cleanMultiline(s).replace(/\s+/g, ' '))
    .pipe(z.string().min(1, `${label} is required.`).max(max, `${label} must be at most ${max} characters.`));

export const createJobAnalysisSchema = z.strictObject({
  companyName: singleLine('Company name', 120),
  jobTitle: singleLine('Job title', 150),
  jobDescription: z
    .string({ error: 'Job description is required.' })
    .transform(cleanMultiline)
    .pipe(
      z
        .string()
        .min(JD_MIN_CHARS, `Paste the full job description (at least ${JD_MIN_CHARS} characters).`)
        .max(JD_MAX_CHARS, `The job description must be at most ${JD_MAX_CHARS.toLocaleString('en-US')} characters.`)
        .refine((s) => (s.match(/[A-Za-z]{2,}/g) ?? []).length >= 12, 'The job description does not contain enough words to analyse.'),
    ),
});

export const listJobAnalysesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
  limit: z.coerce.number().int().min(1).max(50).catch(20),
});
