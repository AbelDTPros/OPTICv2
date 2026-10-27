import { describe, expect, it } from 'vitest';
import { applyWriteMappings } from '../../src/modules/bulk/domain/write-mappings.js';

describe('applyWriteMappings', () => {
  it('copies shared input onto nested business data and skips missing optional sources', () => {
    const next = applyWriteMappings(
      { shippingDetails: { existing: true } },
      { shipDate: '2026-08-23' },
      [
        { source: '$.shipDate', target: '$.shippingDetails.shipDate' },
        { source: '$.shipPoc', target: '$.shippingDetails.shipPoc' }
      ]
    );
    expect(next).toEqual({
      shippingDetails: {
        existing: true,
        shipDate: '2026-08-23'
      }
    });
  });
});
