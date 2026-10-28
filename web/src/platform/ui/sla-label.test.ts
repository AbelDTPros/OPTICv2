import { describe, expect, it } from 'vitest';
import { formatSlaStateLabel, slaStateTone } from './sla-label.js';

describe('sla-label', () => {
  it('maps known clock states to readable labels', () => {
    expect(formatSlaStateLabel('ON_TRACK')).toBe('On track');
    expect(formatSlaStateLabel('WARNING')).toBe('Warning');
    expect(formatSlaStateLabel('BREACHED')).toBe('Past SLA');
    expect(formatSlaStateLabel('PAUSED')).toBe('Paused');
    expect(formatSlaStateLabel(null)).toBeNull();
  });

  it('assigns tones for non-color-only status styling', () => {
    expect(slaStateTone('ON_TRACK')).toBe('ok');
    expect(slaStateTone('WARNING')).toBe('watch');
    expect(slaStateTone('BREACHED')).toBe('critical');
    expect(slaStateTone('PAUSED')).toBe('paused');
  });
});
