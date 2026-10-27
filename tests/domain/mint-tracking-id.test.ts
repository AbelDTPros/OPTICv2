import { describe, expect, it } from 'vitest';
import {
  mintTrackingIdValue,
  TRACKING_ID_PATTERN,
  trackingIdPrefix
} from '../../src/modules/tracking/domain/mint-tracking-id.js';

describe('mintTrackingIdValue', () => {
  it('prefixes MAIL with M- and WORKLOAD with W-', () => {
    expect(trackingIdPrefix('MAIL')).toBe('M');
    expect(trackingIdPrefix('mail')).toBe('M');
    expect(trackingIdPrefix('WORKLOAD')).toBe('W');
    expect(mintTrackingIdValue('MAIL')).toMatch(/^M-/);
    expect(mintTrackingIdValue('WORKLOAD')).toMatch(/^W-/);
  });

  it('uses Crockford Base32 body of length 10', () => {
    for (let index = 0; index < 50; index += 1) {
      const id = mintTrackingIdValue(index % 2 === 0 ? 'MAIL' : 'WORKLOAD');
      expect(id).toMatch(TRACKING_ID_PATTERN);
      expect(id).not.toMatch(/[ILOU]/i);
    }
  });

  it('produces distinct values across many mints', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      seen.add(mintTrackingIdValue('MAIL'));
    }
    expect(seen.size).toBe(200);
  });
});
