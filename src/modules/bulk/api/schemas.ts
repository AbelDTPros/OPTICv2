import { z } from 'zod';

export const executeBulkBody = z.object({
  items: z
    .array(
      z.object({
        entityType: z.string().min(1).default('WORKLOAD'),
        trackingId: z.string().min(1).max(255),
        expectedRowVersion: z.number().int().nonnegative()
      })
    )
    .min(1),
  input: z.record(z.unknown()).optional()
});
