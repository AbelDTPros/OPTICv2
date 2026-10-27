import type { ScheduledActionDefinition } from '../../configuration/domain/types.js';
import { validationFailed } from '../../../platform/errors/app-error.js';
import { isMissing, resolveJsonPath } from '../../../rules/json-path-resolver.js';

export function scheduledActionsForStage(
  definitions: Record<string, ScheduledActionDefinition>,
  stageKey: string
): ScheduledActionDefinition[] {
  return Object.values(definitions).filter((definition) => {
    const trigger = definition.trigger ?? {};
    return trigger.type === 'STAGE_ENTERED' && trigger.stageKey === stageKey;
  });
}

export function shouldCancelOnStageChange(definition: ScheduledActionDefinition | undefined): boolean {
  if (!definition) {
    return true;
  }
  const cancellation = definition.cancellation ?? {};
  return cancellation.cancelIfStageChanges !== false;
}

export function dueAtFromDelay(
  delay: Record<string, unknown> | undefined,
  from = new Date(),
  businessData: Record<string, unknown> = {}
): Date {
  if (delay?.source === 'FIELD') {
    return new Date(from.getTime() + fieldDelayMs(delay, businessData));
  }
  return new Date(from.getTime() + durationMs(delay?.duration));
}

export function fieldDelayPath(delay: Record<string, unknown> | undefined): string | undefined {
  const path = delay?.path ?? delay?.field;
  return typeof path === 'string' && path ? path : undefined;
}

export function triggerStageKey(definition: ScheduledActionDefinition): string | undefined {
  const stageKey = definition.trigger?.stageKey;
  return typeof stageKey === 'string' && stageKey ? stageKey : undefined;
}

export function scheduledActionType(definition: ScheduledActionDefinition): string | undefined {
  const type = definition.action?.type;
  return typeof type === 'string' && type ? type : undefined;
}

export function scheduledTargetStage(definition: ScheduledActionDefinition): string | undefined {
  const target = definition.action?.targetStage;
  return typeof target === 'string' && target ? target : undefined;
}

export function scheduledMaxAttempts(definition: ScheduledActionDefinition | undefined, fallback: number): number {
  const value = definition?.retry?.maxAttempts;
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

export function scheduledBackoff(definition: ScheduledActionDefinition | undefined): 'EXPONENTIAL' | 'FIXED' {
  return definition?.retry?.backoff === 'FIXED' ? 'FIXED' : 'EXPONENTIAL';
}

export function nextRetryDueAt(
  attemptCount: number,
  backoff: 'EXPONENTIAL' | 'FIXED',
  baseMs: number,
  from = new Date()
): Date {
  const exponent = backoff === 'EXPONENTIAL' ? Math.max(0, attemptCount - 1) : 0;
  const delay = Math.min(baseMs * 2 ** exponent, 3_600_000);
  return new Date(from.getTime() + delay);
}

function fieldDelayMs(delay: Record<string, unknown>, businessData: Record<string, unknown>): number {
  const path = fieldDelayPath(delay);
  if (!path) {
    throw validationFailed('OPTIC-WF-40073', 'Scheduled action FIELD delay requires path.');
  }
  const resolved = resolveJsonPath(path, { businessData });
  if (isMissing(resolved) || resolved === null) {
    throw validationFailed('OPTIC-WF-40073', `Scheduled action FIELD delay path ${path} was not found.`);
  }
  if (typeof resolved === 'number' && Number.isFinite(resolved)) {
    return resolved * unitMs(delay.unit);
  }
  if (resolved && typeof resolved === 'object' && !Array.isArray(resolved)) {
    return durationMs(resolved);
  }
  throw validationFailed(
    'OPTIC-WF-40073',
    `Scheduled action FIELD delay path ${path} must resolve to a number or duration object.`
  );
}

function durationMs(duration: unknown): number {
  const value =
    duration && typeof duration === 'object' && !Array.isArray(duration)
      ? (duration as Record<string, unknown>)
      : {};
  return (
    numberOrZero(value.days) * 86_400_000 +
    numberOrZero(value.hours) * 3_600_000 +
    numberOrZero(value.minutes) * 60_000
  );
}

function unitMs(unit: unknown): number {
  if (unit === 'hours') {
    return 3_600_000;
  }
  if (unit === 'minutes') {
    return 60_000;
  }
  return 86_400_000;
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
