import { fieldInputId, validationFailed, type ErrorDetails } from '../../../platform/errors/app-error.js';
import { assertStableKey } from '../domain/keys.js';
import type { DefinitionRelease } from '../domain/types.js';
import { assertFormAccessibility } from '../../../platform/accessibility/form-accessibility.js';
import { isEmptyEligibility } from '../../queue/domain/eligibility.js';
import { validateQueueDefinition } from '../../queue/domain/validate-queue.js';

const IMMUTABLE_STATUSES = new Set(['IN_REVIEW', 'APPROVED', 'PUBLISHED', 'RETIRED']);

export function isImmutableRelease(status: string): boolean {
  return IMMUTABLE_STATUSES.has(status);
}

export function definitionCacheKey(definitionKey: string, version: string): string {
  return `definition-release:${definitionKey}:${version}`;
}

export function validateCompiledDefinition(release: DefinitionRelease): void {
  const details: ErrorDetails = [];

  try {
    assertStableKey(release.definitionKey, 'definitionKey');
  } catch (error) {
    if (error && typeof error === 'object' && 'details' in error) {
      details.push(...((error as { details: ErrorDetails }).details));
    }
  }

  const stages = release.workflow.stages;
  if (stages.length === 0) {
    if (details.length > 0) {
      throw validationFailed('OPTIC-CONFIG-40020', 'Definition release failed stable-key validation.', details);
    }
    return;
  }

  if (!release.workflow.initialStageKey) {
    details.push({
      field: 'initialStageKey',
      path: 'workflow.initialStageKey',
      message: 'A workflow with stages must declare initialStageKey.',
      inputId: fieldInputId('initialStageKey')
    });
  } else if (!stages.some((stage) => stage.stageKey === release.workflow.initialStageKey)) {
    details.push({
      field: 'initialStageKey',
      path: 'workflow.initialStageKey',
      message: `initialStageKey ${release.workflow.initialStageKey} does not exist.`,
      inputId: fieldInputId('initialStageKey')
    });
  }

  for (const terminal of release.workflow.terminalStageKeys) {
    if (!stages.some((stage) => stage.stageKey === terminal)) {
      details.push({
        field: 'terminalStageKeys',
        path: 'workflow.terminalStageKeys',
        message: `Terminal stage ${terminal} does not exist.`,
        inputId: fieldInputId('terminalStageKeys')
      });
    }
  }

  for (const stage of stages) {
    if (stage.formKey && !release.forms[stage.formKey]) {
      details.push({
        field: 'formKey',
        path: `workflow.stages.${stage.stageKey}.formKey`,
        message: `Stage ${stage.stageKey} references missing form ${stage.formKey}.`,
        inputId: fieldInputId(stage.formKey)
      });
    }
    if (stage.queueKey && !release.queues[stage.queueKey]) {
      details.push({
        field: 'queueKey',
        path: `workflow.stages.${stage.stageKey}.queueKey`,
        message: `Stage ${stage.stageKey} references missing queue ${stage.queueKey}.`,
        inputId: fieldInputId(stage.queueKey)
      });
    }
    if (stage.slaKey && !release.slas[stage.slaKey]) {
      details.push({
        field: 'slaKey',
        path: `workflow.stages.${stage.stageKey}.slaKey`,
        message: `Stage ${stage.stageKey} references missing SLA ${stage.slaKey}.`,
        inputId: fieldInputId(stage.slaKey)
      });
    }
    const terminal = Boolean(stage.terminal) || release.workflow.terminalStageKeys.includes(stage.stageKey);
    if (
      !terminal &&
      stage.transitionSetKey &&
      !release.workflow.transitionSets.some((set) => set.transitionSetKey === stage.transitionSetKey)
    ) {
      details.push({
        field: 'transitionSetKey',
        path: `workflow.stages.${stage.stageKey}.transitionSetKey`,
        message: `Stage ${stage.stageKey} references missing transition set ${stage.transitionSetKey}.`,
        inputId: fieldInputId(stage.transitionSetKey)
      });
    }
    for (const actionKey of stage.actionKeys) {
      if (!release.actions[actionKey]) {
        details.push({
          field: 'actionKey',
          path: `workflow.stages.${stage.stageKey}.actionKeys`,
          message: `Stage ${stage.stageKey} references missing action ${actionKey}.`,
          inputId: fieldInputId(actionKey)
        });
      }
    }
    for (const bulkKey of stage.bulkActionKeys ?? []) {
      if (!release.bulkActions[bulkKey]) {
        details.push({
          field: 'bulkActionKey',
          path: `workflow.stages.${stage.stageKey}.bulkActionKeys`,
          message: `Stage ${stage.stageKey} references missing bulk action ${bulkKey}.`,
          inputId: fieldInputId(bulkKey)
        });
      }
    }
  }

  const stageKeys = new Set(stages.map((stage) => stage.stageKey));
  for (const set of release.workflow.transitionSets) {
    if (set.defaultTargetStageKey && !stageKeys.has(set.defaultTargetStageKey)) {
      details.push({
        field: 'defaultTargetStageKey',
        path: `workflow.transitionSets.${set.transitionSetKey}.defaultTargetStageKey`,
        message: `Transition set ${set.transitionSetKey} targets missing stage ${set.defaultTargetStageKey}.`,
        inputId: fieldInputId(set.defaultTargetStageKey)
      });
    }
    for (const rule of set.rules) {
      if (!stageKeys.has(rule.targetStageKey)) {
        details.push({
          field: 'targetStageKey',
          path: `workflow.transitionSets.${set.transitionSetKey}.rules.${rule.ruleKey}`,
          message: `Rule ${rule.ruleKey} targets missing stage ${rule.targetStageKey}.`,
          inputId: fieldInputId(rule.targetStageKey)
        });
      }
    }
  }

  for (const action of Object.values(release.actions)) {
    if (action.transitionSetKey && !release.workflow.transitionSets.some((set) => set.transitionSetKey === action.transitionSetKey)) {
      details.push({
        field: 'transitionSetKey',
        path: `actions.${action.actionKey}.transitionSetKey`,
        message: `Action ${action.actionKey} references missing transition set ${action.transitionSetKey}.`,
        inputId: fieldInputId(action.transitionSetKey)
      });
    }
  }

  for (const queue of Object.values(release.queues)) {
    if (isEmptyEligibility(queue.eligibility) && queue.columns.length === 0) {
      continue;
    }
    try {
      validateQueueDefinition(queue, { requireEligibility: false });
    } catch (error) {
      if (error && typeof error === 'object' && 'details' in error) {
        details.push(...((error as { details: ErrorDetails }).details));
      }
    }
  }

  for (const form of Object.values(release.forms)) {
    try {
      assertFormAccessibility(form, { entityType: release.entityType });
    } catch (error) {
      if (error && typeof error === 'object' && 'details' in error) {
        details.push(...((error as { details: ErrorDetails }).details));
      }
    }
  }

  if (details.length > 0) {
    throw validationFailed(
      'OPTIC-CONFIG-40020',
      'Definition release failed stable-key or reference validation.',
      details
    );
  }
}
