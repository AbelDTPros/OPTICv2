const SENSITIVE_PATH = /anumber|a_number|receipt|ssn|password|secret|token|name|email|dob|birth/i;

export interface TraceEntry {
  ruleKey?: string;
  path?: string;
  operator?: string;
  result: 'MATCH' | 'NO_MATCH' | 'ERROR';
  valueKind?: string;
  resolvedValue?: unknown;
  message?: string;
}

export function describeResolved(path: string | undefined, value: unknown, missing: boolean): Pick<TraceEntry, 'valueKind' | 'resolvedValue'> {
  if (missing) {
    return { valueKind: 'MISSING' };
  }
  if (value === null) {
    return { valueKind: 'null', resolvedValue: null };
  }
  const valueKind = Array.isArray(value) ? 'array' : typeof value;
  if (path && SENSITIVE_PATH.test(path)) {
    return { valueKind, resolvedValue: '[REDACTED]' };
  }
  if (valueKind === 'string' || valueKind === 'object' || valueKind === 'array') {
    return { valueKind, resolvedValue: '[REDACTED]' };
  }
  return { valueKind, resolvedValue: value };
}
