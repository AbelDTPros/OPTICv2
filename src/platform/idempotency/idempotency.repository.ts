import { createHash } from 'node:crypto';
import type { QueryExecutor } from '../db/types.js';

export interface IdempotencyRecord {
  actorId: string;
  operation: string;
  idempotencyKey: string;
  requestHash: string;
  response: unknown;
}

export interface IdempotencyRepository {
  find(
    actorId: string,
    operation: string,
    idempotencyKey: string,
    executor?: QueryExecutor
  ): Promise<IdempotencyRecord | null>;
  save(record: IdempotencyRecord, executor?: QueryExecutor): Promise<void>;
}

export function hashIdempotencyRequest(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`).join(',')}}`;
}
