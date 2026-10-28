import { describe, expect, it } from 'vitest';
import type { DefinitionRelease, SlaDefinition } from '../../src/modules/configuration/domain/types.js';
import {
  computeSlaState,
  elapsedBusinessHours,
  isBreachedSlaState,
  resolveStageSla
} from '../../src/modules/queue/domain/sla-state.js';

const sla: SlaDefinition = {
  slaKey: 'DATA_ENTRY_SLA',
  clock: 'CALENDAR',
  target: { durationHours: 40 },
  warningThresholdPercent: 75,
  breachThresholdPercent: 100,
  severityOnBreach: 'HIGH'
};

describe('sla-state', () => {
  const entered = new Date('2026-01-01T00:00:00.000Z');

  it('returns null when no SLA is configured', () => {
    expect(
      computeSlaState({
        sla: undefined,
        enteredStageAt: entered,
        now: new Date('2026-01-02T00:00:00.000Z')
      })
    ).toBeNull();
  });

  it('is ON_TRACK before the warning threshold', () => {
    expect(
      computeSlaState({
        sla,
        enteredStageAt: entered,
        now: new Date('2026-01-01T20:00:00.000Z') // 20h of 40 → 50%
      })
    ).toBe('ON_TRACK');
  });

  it('is WARNING at or after the warning threshold', () => {
    expect(
      computeSlaState({
        sla,
        enteredStageAt: entered,
        now: new Date('2026-01-02T06:00:00.000Z') // 30h of 40 → 75%
      })
    ).toBe('WARNING');
  });

  it('is BREACHED at or after the breach threshold', () => {
    expect(
      computeSlaState({
        sla,
        enteredStageAt: entered,
        now: new Date('2026-01-02T16:00:00.000Z') // 40h
      })
    ).toBe('BREACHED');
  });

  it('is PAUSED when the current stage is in pauseWhen', () => {
    expect(
      computeSlaState({
        sla: { ...sla, pauseWhen: { stages: ['ON_HOLD'] } },
        enteredStageAt: entered,
        currentStageKey: 'ON_HOLD',
        now: new Date('2026-01-10T00:00:00.000Z')
      })
    ).toBe('PAUSED');
  });

  it('resolves the stage SLA from the release', () => {
    const release = {
      workflow: {
        initialStageKey: 'DATA_ENTRY',
        stages: [{ stageKey: 'DATA_ENTRY', slaKey: 'DATA_ENTRY_SLA' }],
        terminalStageKeys: [],
        transitionSets: []
      },
      slas: { DATA_ENTRY_SLA: sla }
    } as unknown as DefinitionRelease;
    expect(resolveStageSla(release, 'DATA_ENTRY')).toEqual(sla);
    expect(resolveStageSla(release, 'OTHER')).toBeUndefined();
  });

  it('detects breached aliases', () => {
    expect(isBreachedSlaState('BREACHED')).toBe(true);
    expect(isBreachedSlaState('WARNING')).toBe(false);
    expect(isBreachedSlaState(null)).toBe(false);
  });

  it('excludes weekend hours for BUSINESS clocks', () => {
    // Friday 12:00 UTC → Monday 12:00 UTC = 24 business hours (weekend ignored)
    const friday = new Date('2026-01-02T12:00:00.000Z'); // Friday
    const monday = new Date('2026-01-05T12:00:00.000Z'); // Monday
    expect(elapsedBusinessHours(friday, monday)).toBe(24);
    expect(
      computeSlaState({
        sla: { ...sla, clock: 'BUSINESS', target: { durationHours: 24 } },
        enteredStageAt: friday,
        now: monday
      })
    ).toBe('BREACHED');
    expect(
      computeSlaState({
        sla: { ...sla, clock: 'BUSINESS', target: { durationHours: 40 } },
        enteredStageAt: friday,
        now: monday
      })
    ).toBe('ON_TRACK');
  });
});
