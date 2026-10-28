const WORKLOAD_TYPE_PREF_KEY = 'optic.workloadType.kindKey';

export function readWorkloadTypePref(): string | undefined {
  try {
    const raw = window.localStorage.getItem(WORKLOAD_TYPE_PREF_KEY)?.trim();
    return raw || undefined;
  } catch {
    return undefined;
  }
}

export function writeWorkloadTypePref(kindKey: string | undefined): void {
  try {
    if (!kindKey) {
      window.localStorage.removeItem(WORKLOAD_TYPE_PREF_KEY);
    } else {
      window.localStorage.setItem(WORKLOAD_TYPE_PREF_KEY, kindKey);
    }
  } catch {
    // ignore quota / private mode
  }
}

export function resolveWorkloadTypeSelection(
  kinds: Array<{ kindKey: string }>,
  current: string | undefined
): string | undefined {
  if (current && kinds.some((kind) => kind.kindKey === current)) {
    return current;
  }
  const stored = readWorkloadTypePref();
  if (stored && kinds.some((kind) => kind.kindKey === stored)) {
    return stored;
  }
  return undefined;
}
