import { z } from 'zod';

const stableKey = z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'Must be an uppercase snake-case semantic key');

const assignmentPolicy = z.object({
  required: z.boolean(),
  clearOnTransition: z.boolean(),
  allowAssign: z.boolean().optional(),
  allowReassign: z.boolean().optional(),
  allowRelease: z.boolean().optional()
});

const ruleExpression: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(ruleExpression) }),
    z.object({ any: z.array(ruleExpression) }),
    z.object({ not: ruleExpression }),
    z.object({
      path: z.string().min(1),
      operator: z.string().min(1),
      value: z.unknown().optional()
    })
  ])
);

export const createDefinitionBody = z.object({
  definitionKey: stableKey,
  displayName: z.string().min(1),
  entityType: z.string().min(1)
});

export const createReleaseBody = z
  .object({
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    cloneFromVersion: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
    cloneFromDefinitionKey: stableKey.optional()
  })
  .superRefine((body, ctx) => {
    if (body.cloneFromDefinitionKey && !body.cloneFromVersion) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cloneFromVersion'],
        message: 'cloneFromVersion is required when cloneFromDefinitionKey is set'
      });
    }
  });

export const workflowBody = z.object({
  expectedRowVersion: z.number().int().nonnegative(),
  workflow: z.object({
    initialStageKey: z.string(),
    terminalStageKeys: z.array(z.string()),
    stages: z.array(
      z.object({
        stageKey: stableKey,
        displayName: z.string().min(1),
        order: z.number().int(),
        terminal: z.boolean().optional(),
        formKey: stableKey.optional(),
        queueKey: stableKey.optional(),
        actionKeys: z.array(stableKey),
        bulkActionKeys: z.array(stableKey).optional(),
        slaKey: stableKey.optional(),
        transitionSetKey: stableKey.optional(),
        assignmentPolicy,
        layout: z.object({ x: z.number(), y: z.number() }).optional()
      })
    ),
    transitionSets: z.array(
      z.object({
        transitionSetKey: stableKey,
        evaluationMode: z.literal('FIRST_MATCH'),
        rules: z.array(
          z.object({
            ruleKey: stableKey,
            priority: z.number().int(),
            when: ruleExpression,
            targetStageKey: stableKey,
            description: z.string().optional()
          })
        ),
        defaultTargetStageKey: stableKey.optional()
      })
    )
  })
});

const draftEnvelope = <T extends z.ZodTypeAny>(payload: T) =>
  z.object({
    expectedRowVersion: z.number().int().nonnegative(),
    payload
  });

export const formBody = draftEnvelope(
  z.object({
    formKey: stableKey,
    dataPath: z.string().min(1),
    schemaRef: z.string().optional(),
    schema: z.record(z.unknown()).optional(),
    title: z.string().min(1),
    sections: z.array(z.record(z.unknown())),
    behaviors: z.array(z.record(z.unknown())).optional()
  })
);

export const actionBody = draftEnvelope(
  z.object({
    actionKey: stableKey,
    label: z.string().min(1),
    type: z.string().min(1),
    requireAssignmentToCurrentUser: z.boolean().optional(),
    validation: z
      .object({
        validateStageForm: z.boolean(),
        schemaRef: z.string().optional()
      })
      .optional(),
    transitionSetKey: stableKey.optional(),
    assignment: z.object({ clearOnTransition: z.boolean() }).optional(),
    confirmation: z.object({ required: z.boolean(), message: z.string() }).optional(),
    audit: z.object({ eventType: z.string() }).optional()
  })
);

export const queueBody = draftEnvelope(
  z.object({
    queueKey: stableKey,
    displayName: z.string().min(1),
    entityType: z.string().min(1),
    eligibility: z.record(z.unknown()),
    defaultSort: z.array(z.object({ field: z.string(), direction: z.enum(['ASC', 'DESC']) })),
    columns: z.array(z.string()),
    filters: z.array(z.string()),
    actions: z.array(z.string()),
    pageSize: z.number().int().positive(),
    projectedFields: z
      .array(
        z.object({
          fieldKey: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'Must be a letter-led field key, for example firstName.'),
          label: z.string().min(1),
          path: z.string().min(1)
        })
      )
      .optional()
  })
);

export const bulkActionBody = draftEnvelope(
  z.object({
    bulkActionKey: stableKey,
    label: z.string().min(1),
    stageKey: stableKey,
    maxSelection: z.number().int().positive(),
    transactionMode: z.enum(['ATOMIC', 'BEST_EFFORT']),
    eligibility: z.record(z.unknown()).optional(),
    sharedInputSchema: z.record(z.unknown()).optional(),
    writeMappings: z.array(z.object({ source: z.string(), target: z.string() })).optional(),
    transition: z.object({ targetStage: stableKey }).optional()
  })
);

export const scheduledActionBody = draftEnvelope(
  z.object({
    scheduledActionKey: stableKey,
    trigger: z.record(z.unknown()),
    delay: z.record(z.unknown()),
    action: z.record(z.unknown()),
    cancellation: z.record(z.unknown()).optional(),
    retry: z.record(z.unknown()).optional()
  })
);

export const slaBody = draftEnvelope(
  z.object({
    slaKey: stableKey,
    clock: z.enum(['CALENDAR', 'BUSINESS']),
    target: z.object({ durationHours: z.number().positive() }),
    warningThresholdPercent: z.number(),
    breachThresholdPercent: z.number(),
    pauseWhen: z.object({ stages: z.array(stableKey) }).optional(),
    severityOnBreach: z.string().min(1)
  })
);

export const searchBody = draftEnvelope(
  z.object({
    searchKey: stableKey.default('DEFAULT'),
    fields: z.array(
      z.object({
        fieldKey: z.string().min(1),
        source: z.enum(['SYSTEM', 'BUSINESS_DATA']),
        path: z.string().min(1),
        match: z.string().min(1),
        pii: z.boolean(),
        useInSearch: z.boolean().optional(),
        useInDashboard: z.boolean().optional()
      })
    )
  })
);

export const schemaBody = draftEnvelope(z.record(z.unknown()));

export const simulateBody = z.object({
  transitionSetKey: z.string().min(1),
  businessData: z.unknown().optional(),
  workflowContext: z.record(z.unknown()).optional()
});

export const importReleaseBody = z.object({
  package: z.record(z.unknown()),
  checksum: z.string().min(1),
  checksumAlgorithm: z.literal('SHA-256').optional(),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .optional(),
  createDefinitionIfMissing: z.boolean().optional(),
  mode: z.enum(['DRAFT', 'PUBLISHED']).optional()
});

export const expectedRowVersionBody = z.object({
  expectedRowVersion: z.number().int().nonnegative()
});

export const lifecycleBody = z.object({
  expectedRowVersion: z.number().int().nonnegative(),
  comment: z.string().max(2000).optional()
});
