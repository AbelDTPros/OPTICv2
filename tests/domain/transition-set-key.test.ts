import { describe, expect, it } from 'vitest';
import { resolveTransitionSetKey } from '../../src/modules/configuration/domain/transition-set-key.js';

describe('resolveTransitionSetKey', () => {
  it('prefers the stage override over the catalog action', () => {
    expect(
      resolveTransitionSetKey(
        { transitionSetKey: 'FROM_SHIPPING' },
        { transitionSetKey: 'FROM_DATA_ENTRY' }
      )
    ).toBe('FROM_SHIPPING');
  });

  it('falls back to the action when the stage has no override', () => {
    expect(resolveTransitionSetKey({}, { transitionSetKey: 'FROM_DATA_ENTRY' })).toBe('FROM_DATA_ENTRY');
  });
});
