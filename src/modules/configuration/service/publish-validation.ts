import { fieldInputId, validationFailed, type ErrorDetails } from '../../../platform/errors/app-error.js';
import { compileRuleExpressions } from '../../../rules/compile-rules.js';
import { validateCompiledDefinition } from '../definitions/definition-validator.js';
import { compileBusinessSchema } from '../definitions/schema-compiler.js';
import type { DefinitionRelease } from '../domain/types.js';
import { validateQueueDefinition } from '../../queue/domain/validate-queue.js';

export function assertPublishableDefinition(release: DefinitionRelease): void {
  validateCompiledDefinition(release);

  const details: ErrorDetails = [];
  if (release.workflow.stages.length === 0) {
    details.push({
      field: 'stages',
      path: 'workflow.stages',
      message: 'A publishable release must declare at least one stage.',
      inputId: fieldInputId('stages')
    });
  }

  const stageKeys = new Set(release.workflow.stages.map((stage) => stage.stageKey));
  for (const action of Object.values(release.actions)) {
    if (action.type === 'TRANSITION' && !action.transitionSetKey) {
      details.push({
        field: 'transitionSetKey',
        path: `actions.${action.actionKey}.transitionSetKey`,
        message: `Transition action ${action.actionKey} must declare transitionSetKey.`,
        inputId: fieldInputId(action.actionKey)
      });
    }
  }

  for (const bulk of Object.values(release.bulkActions)) {
    if (!stageKeys.has(bulk.stageKey)) {
      details.push({
        field: 'stageKey',
        path: `bulkActions.${bulk.bulkActionKey}.stageKey`,
        message: `Bulk action ${bulk.bulkActionKey} references missing stage ${bulk.stageKey}.`,
        inputId: fieldInputId(bulk.bulkActionKey)
      });
    }
    if (bulk.transition?.targetStage && !stageKeys.has(bulk.transition.targetStage)) {
      details.push({
        field: 'targetStage',
        path: `bulkActions.${bulk.bulkActionKey}.transition.targetStage`,
        message: `Bulk action ${bulk.bulkActionKey} targets missing stage ${bulk.transition.targetStage}.`,
        inputId: fieldInputId(bulk.bulkActionKey)
      });
    }
  }

  for (const queue of Object.values(release.queues)) {
    try {
      validateQueueDefinition(queue, { requireEligibility: true });
    } catch (error) {
      if (error && typeof error === 'object' && 'details' in error) {
        details.push(...((error as { details: ErrorDetails }).details));
      }
    }
  }

  for (const scheduled of Object.values(release.scheduledActions)) {
    const stageKey = scheduled.trigger.stageKey;
    if (typeof stageKey === 'string' && stageKey && !stageKeys.has(stageKey)) {
      details.push({
        field: 'stageKey',
        path: `scheduledActions.${scheduled.scheduledActionKey}.trigger.stageKey`,
        message: `Scheduled action ${scheduled.scheduledActionKey} references missing stage ${stageKey}.`,
        inputId: fieldInputId(scheduled.scheduledActionKey)
      });
    }
    if (scheduled.action?.type === 'TRANSITION') {
      const targetStage = scheduled.action.targetStage;
      if (typeof targetStage !== 'string' || !targetStage) {
        details.push({
          field: 'targetStage',
          path: `scheduledActions.${scheduled.scheduledActionKey}.action.targetStage`,
          message: `Scheduled action ${scheduled.scheduledActionKey} TRANSITION requires targetStage.`,
          inputId: fieldInputId(scheduled.scheduledActionKey)
        });
      } else if (!stageKeys.has(targetStage)) {
        details.push({
          field: 'targetStage',
          path: `scheduledActions.${scheduled.scheduledActionKey}.action.targetStage`,
          message: `Scheduled action ${scheduled.scheduledActionKey} targets missing stage ${targetStage}.`,
          inputId: fieldInputId(scheduled.scheduledActionKey)
        });
      }
    }
    if (scheduled.delay?.source === 'FIELD') {
      const path = scheduled.delay.path ?? scheduled.delay.field;
      if (typeof path !== 'string' || !(path.startsWith('$') || path.startsWith('$workflow'))) {
        details.push({
          field: 'path',
          path: `scheduledActions.${scheduled.scheduledActionKey}.delay.path`,
          message: `Scheduled action ${scheduled.scheduledActionKey} FIELD delay requires a JSONPath path.`,
          inputId: fieldInputId(scheduled.scheduledActionKey)
        });
      }
    }
  }

  if (details.length > 0) {
    throw validationFailed(
      'OPTIC-CONFIG-40025',
      'Definition release is not complete enough to submit or publish.',
      details
    );
  }

  compileBusinessSchema(release.schema);
  compileRuleExpressions(release);
}
