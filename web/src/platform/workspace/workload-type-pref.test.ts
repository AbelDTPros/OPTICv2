import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readWorkloadTypePref,
  resolveWorkloadTypeSelection,
  writeWorkloadTypePref
} from './workload-type-pref.js';

describe('workload-type-pref', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size;
      }
    });
  });

  it('persists and restores a workload type key', () => {
    expect(readWorkloadTypePref()).toBeUndefined();
    writeWorkloadTypePref('I_407');
    expect(readWorkloadTypePref()).toBe('I_407');
    writeWorkloadTypePref(undefined);
    expect(readWorkloadTypePref()).toBeUndefined();
  });

  it('prefers the current selection, then stored, when still available', () => {
    const kinds = [{ kindKey: 'I_407' }, { kindKey: 'I_936' }];
    writeWorkloadTypePref('I_936');
    expect(resolveWorkloadTypeSelection(kinds, 'I_407')).toBe('I_407');
    expect(resolveWorkloadTypeSelection(kinds, undefined)).toBe('I_936');
    expect(resolveWorkloadTypeSelection([{ kindKey: 'I_131' }], undefined)).toBeUndefined();
  });
});
