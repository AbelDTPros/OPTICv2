import { z } from 'zod';

export const queuePageQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  sort: z.string().min(1).optional(),
  direction: z.enum(['ASC', 'DESC']).optional(),
  assignedStatus: z.string().min(1).optional(),
  workloadType: z.string().min(1).optional(),
  slaState: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  location: z.string().min(1).optional(),
  definitionKey: z.string().min(1).optional(),
  receiptNumber: z.string().min(1).optional()
});

export const queueAssignBody = z.object({
  entityType: z.string().min(1).default('WORKLOAD'),
  trackingId: z.string().min(1),
  expectedRowVersion: z.number().int().nonnegative(),
  definitionKey: z.string().min(1).optional()
});

export const queueReassignBody = queueAssignBody.extend({
  assignedTo: z.string().min(1).max(255)
});
