import { z } from 'zod';

export const createInstanceBody = z.object({
  entityType: z.string().min(1),
  entityTrackingId: z.string().min(1).max(255),
  definitionKey: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/).optional()
});

export const listInstancesQuery = z.object({
  definitionKey: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/)
});

export const scanQuery = z.object({
  q: z.string().min(1).max(512)
});

export const enterStageBody = z.object({
  stageKey: z.string().min(1),
  expectedRowVersion: z.number().int().nonnegative(),
  exitActionKey: z.string().min(1).optional(),
  reentry: z.literal(true)
});

export const assignmentBody = z.object({
  expectedRowVersion: z.number().int().nonnegative()
});

export const reassignBody = z.object({
  expectedRowVersion: z.number().int().nonnegative(),
  assignedTo: z.string().min(1).max(255)
});

export const saveDraftBody = z.object({
  expectedRowVersion: z.number().int().nonnegative(),
  dataPatch: z.record(z.unknown()),
  stageKey: z.string().min(1).optional()
});

export const executeActionBody = z.object({
  expectedRowVersion: z.number().int().nonnegative(),
  dataPatch: z.record(z.unknown()).optional(),
  comment: z.string().max(2000).optional()
});
