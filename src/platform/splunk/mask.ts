import { sanitize } from '../logging/logger.js';

const SENSITIVE_CLASSIFICATIONS = new Set(['PII', 'SENSITIVE', 'RESTRICTED']);
const DEFAULT_PREFIX_CHARS = 1;
const DEFAULT_SUFFIX_CHARS = 3;

export interface SplunkPolicyObject {
  mode?: string;
  maskStrategy?: string;
  prefixChars?: number;
  suffixChars?: number;
}

export type SplunkPolicy = string | SplunkPolicyObject | null | undefined;

export function maskForSplunk(value: unknown, policy?: SplunkPolicy, classification?: string): unknown {
  const mode = resolveMode(policy, classification);
  if (mode === 'ALLOW' || mode === 'NONE') {
    return value;
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (mode === 'REDACT' || typeof value !== 'string') {
    return '[REDACTED]';
  }
  return maskString(value, policy);
}

export function projectPayloadForSplunk(payload: Record<string, unknown>): Record<string, unknown> {
  const cloned = structuredClone(payload);
  if (Array.isArray(cloned.fieldDeltas)) {
    cloned.fieldDeltas = cloned.fieldDeltas.map((delta) => maskDelta(delta));
  }
  if (cloned.payload && typeof cloned.payload === 'object' && !Array.isArray(cloned.payload)) {
    const inner = cloned.payload as Record<string, unknown>;
    if (Array.isArray(inner.fieldDeltas)) {
      inner.fieldDeltas = inner.fieldDeltas.map((delta) => maskDelta(delta));
    }
    if (Array.isArray(inner.changes)) {
      inner.changes = inner.changes.map((delta) => maskDelta(delta));
    }
  }
  if (Array.isArray(cloned.changes)) {
    cloned.changes = cloned.changes.map((delta) => maskDelta(delta));
  }
  return sanitize(cloned) as Record<string, unknown>;
}

function maskDelta(delta: unknown): unknown {
  if (!delta || typeof delta !== 'object' || Array.isArray(delta)) {
    return delta;
  }
  const record = delta as Record<string, unknown>;
  const policy = (record.splunkPolicy ?? record.splunk_policy) as SplunkPolicy;
  const classification =
    typeof record.piiClassification === 'string'
      ? record.piiClassification
      : typeof record.classification === 'string'
        ? record.classification
        : undefined;
  return {
    ...record,
    before: maskForSplunk(record.before, policy, classification),
    after: maskForSplunk(record.after, policy, classification)
  };
}

function resolveMode(policy: SplunkPolicy, classification?: string): string {
  const object = asPolicyObject(policy);
  const raw = object?.mode ?? (typeof policy === 'string' ? policy : undefined);
  const mode = (raw ?? '').toString().trim().toUpperCase();
  if (mode) {
    return mode;
  }
  if (classification && SENSITIVE_CLASSIFICATIONS.has(classification.toUpperCase())) {
    return 'MASK';
  }
  return 'ALLOW';
}

function maskString(value: string, policy: SplunkPolicy): string {
  const object = asPolicyObject(policy);
  const prefixChars = integerOr(object?.prefixChars, DEFAULT_PREFIX_CHARS);
  const suffixChars = integerOr(object?.suffixChars, DEFAULT_SUFFIX_CHARS);
  if (value.length <= prefixChars + suffixChars) {
    return '[REDACTED]';
  }
  const prefix = value.slice(0, prefixChars);
  const suffix = value.slice(value.length - suffixChars);
  return `${prefix}${'*'.repeat(value.length - prefixChars - suffixChars)}${suffix}`;
}

function asPolicyObject(policy: SplunkPolicy): SplunkPolicyObject | undefined {
  if (policy && typeof policy === 'object' && !Array.isArray(policy)) {
    return policy;
  }
  return undefined;
}

function integerOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
}
