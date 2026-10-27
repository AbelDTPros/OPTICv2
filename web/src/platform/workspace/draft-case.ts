import { assignmentPermissions } from '../../../../src/modules/configuration/domain/assignment-policy.js';
import type {
  ActionDefinition,
  JsonSchema,
  StageFormDefinition,
  WorkflowDefinition
} from '../../../../src/modules/configuration/domain/types.js';
import type { WorkflowSummary } from '../designers/workflow-api.js';

const DRAFT_INSTANCE_ID = 0;

export function isDraftCase(summary: Pick<WorkflowSummary, 'workflowInstanceId'>): boolean {
  return summary.workflowInstanceId === DRAFT_INSTANCE_ID;
}

/** Client-only intake case. Persists on first assign / complete / save. */
export function buildDraftCase(input: {
  trackingId: string;
  entityType: string;
  definitionKey: string;
  version: string;
  workflow: WorkflowDefinition;
  forms: Record<string, StageFormDefinition>;
  actions?: Record<string, ActionDefinition>;
  schema?: Record<string, unknown>;
}): WorkflowSummary {
  const stageKey = input.workflow.initialStageKey;
  const stage = input.workflow.stages.find((item) => item.stageKey === stageKey);
  const formKey = stage?.formKey;
  const form = formKey ? input.forms[formKey] : undefined;
  const now = new Date().toISOString();

  return {
    trackingId: input.trackingId,
    entityType: input.entityType,
    workflowInstanceId: DRAFT_INSTANCE_ID,
    status: 'DRAFT',
    definition: {
      definitionKey: input.definitionKey,
      version: input.version,
      releaseId: 'draft'
    },
    workflow: {
      currentStageKey: stageKey,
      currentStageLabel: stage?.displayName ?? stageKey,
      enteredStageAt: now,
      assignedTo: null,
      rowVersion: 0,
      openVisitNumber: null
    },
    assignmentPermissions: assignmentPermissions(stage, 'DRAFT'),
    businessData: {},
    allowedActions: (stage?.actionKeys ?? []).map((actionKey) => ({
      actionKey,
      label: input.actions?.[actionKey]?.label ?? actionKey
    })),
    stageForm: form
      ? {
          formKey: form.formKey,
          title: form.title,
          dataPath: form.dataPath,
          schema: (form.schema ?? input.schema ?? {}) as JsonSchema,
          ui: form
        }
      : null,
    visits: [],
    forms: input.forms,
    workflowDefinition: input.workflow
  };
}
