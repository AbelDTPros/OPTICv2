import type { DefinitionRelease, SlaDefinition } from '../../configuration/domain/types.js';

/** Persisted / displayed SLA clock state for a projected case. */
export type SlaClockState = 'ON_TRACK' | 'WARNING' | 'BREACHED' | 'PAUSED';

export function resolveStageSla(
  release: Pick<DefinitionRelease, 'workflow' | 'slas'> | undefined,
  stageKey: string
): SlaDefinition | undefined {
  if (!release?.workflow?.stages) {
    return undefined;
  }
  const stage = release.workflow.stages.find((item) => item.stageKey === stageKey);
  const slaKey = stage?.slaKey?.trim();
  if (!slaKey) {
    return undefined;
  }
  return release.slas?.[slaKey];
}

/**
 * Derive SLA state from stage clock definition and when the case entered the stage.
 * CALENDAR uses wall-clock hours; BUSINESS excludes Saturday/Sunday (no holiday calendar yet).
 */
export function computeSlaState(input: {
  sla: SlaDefinition | undefined;
  enteredStageAt: Date;
  currentStageKey?: string;
  now?: Date;
}): SlaClockState | null {
  const { sla, enteredStageAt, currentStageKey } = input;
  if (!sla?.target?.durationHours || sla.target.durationHours <= 0) {
    return null;
  }
  if (
    currentStageKey &&
    sla.pauseWhen?.stages?.some((stage) => stage === currentStageKey)
  ) {
    return 'PAUSED';
  }

  const now = input.now ?? new Date();
  const elapsedHours =
    sla.clock === 'BUSINESS'
      ? elapsedBusinessHours(enteredStageAt, now)
      : Math.max(0, now.getTime() - enteredStageAt.getTime()) / 3_600_000;
  const targetHours = sla.target.durationHours;
  const warningPercent = Math.max(0, sla.warningThresholdPercent ?? 75);
  const breachPercent = Math.max(warningPercent, sla.breachThresholdPercent ?? 100);
  const warningHours = targetHours * (warningPercent / 100);
  const breachHours = targetHours * (breachPercent / 100);

  if (elapsedHours >= breachHours) {
    return 'BREACHED';
  }
  if (elapsedHours >= warningHours) {
    return 'WARNING';
  }
  return 'ON_TRACK';
}

export function isBreachedSlaState(state: string | null | undefined): boolean {
  const normalized = (state ?? '').toUpperCase();
  return normalized === 'BREACHED' || normalized === 'PAST' || normalized === 'PAST_SLA';
}

/** Elapsed hours counting only Mon–Fri (UTC). Weekends contribute 0. */
export function elapsedBusinessHours(from: Date, to: Date): number {
  if (to.getTime() <= from.getTime()) {
    return 0;
  }
  let ms = 0;
  let cursor = from.getTime();
  const end = to.getTime();
  while (cursor < end) {
    const dayStart = new Date(cursor);
    const day = dayStart.getUTCDay(); // 0 Sun … 6 Sat
    const nextMidnight = Date.UTC(
      dayStart.getUTCFullYear(),
      dayStart.getUTCMonth(),
      dayStart.getUTCDate() + 1
    );
    const segmentEnd = Math.min(end, nextMidnight);
    if (day !== 0 && day !== 6) {
      ms += segmentEnd - cursor;
    }
    cursor = segmentEnd;
  }
  return ms / 3_600_000;
}
