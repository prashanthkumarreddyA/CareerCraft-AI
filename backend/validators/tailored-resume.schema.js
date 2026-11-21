import { z } from 'zod';

const revision = z.number({ error: 'expectedRevision is required.' }).int().min(0);

export const decisionSchema = z.discriminatedUnion('decision', [
  // confirmReview: the user checked a proposal the meaning checker could not confirm.
  z.strictObject({ decision: z.literal('accept'), expectedRevision: revision, confirmReview: z.boolean().optional() }),
  z.strictObject({ decision: z.literal('reject'), expectedRevision: revision }),
  z.strictObject({ decision: z.literal('reset'), expectedRevision: revision }),
  z.strictObject({
    decision: z.literal('edit'),
    expectedRevision: revision,
    text: z.string({ error: 'Text is required.' }).max(2000, 'The text is too long.'),
    confirmOverride: z.boolean().optional(),
    confirmReview: z.boolean().optional(),
  }),
]);

export const revisionSchema = z.strictObject({ expectedRevision: revision });
