import { describe, expect, it } from 'vitest';
import { buildScanPayload, parseScanPayload } from '../../src/modules/tracking/domain/scan-payload.js';

describe('scan payload', () => {
  it('builds and parses an OPTIC label', () => {
    const payload = buildScanPayload('mail', 'abc-123');
    expect(payload).toBe('OPTIC:MAIL:abc-123');
    expect(parseScanPayload(payload)).toEqual({ entityType: 'MAIL', trackingId: 'abc-123' });
  });

  it('treats a bare tracking id as a lookup', () => {
    expect(parseScanPayload('  WL-1  ')).toEqual({ trackingId: 'WL-1' });
  });

  it('returns undefined for a blank scan', () => {
    expect(parseScanPayload('   ')).toBeUndefined();
  });
});
