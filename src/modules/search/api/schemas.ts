import { z } from 'zod';

const criteriaRecord = z.record(z.string(), z.string().max(255));

export const searchQuery = z.object({
  q: z.string().max(255).optional(),
  receiptNumber: z.string().max(255).optional(),
  entityType: z.string().min(1).optional(),
  definitionKey: z.string().min(1).optional(),
  currentStageKey: z.string().min(1).optional(),
  assignedTo: z.string().min(1).optional(),
  criteria: z
    .union([
      criteriaRecord,
      z.string().transform((value, ctx) => {
        try {
          const parsed = JSON.parse(value) as unknown;
          const result = criteriaRecord.safeParse(parsed);
          if (!result.success) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'criteria must be a string map.' });
            return z.NEVER;
          }
          return result.data;
        } catch {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'criteria must be valid JSON.' });
          return z.NEVER;
        }
      })
    ])
    .optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional()
});
