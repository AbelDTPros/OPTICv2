import { conflict } from '../errors/app-error.js';
import type { IdempotencyRecord, IdempotencyRepository } from './idempotency.repository.js';

export class InMemoryIdempotencyRepository implements IdempotencyRepository {
  private readonly records = new Map<string, IdempotencyRecord>();

  async find(actorId: string, operation: string, idempotencyKey: string): Promise<IdempotencyRecord | null> {
    const existing = this.records.get(key(actorId, operation, idempotencyKey));
    return existing ? structuredClone(existing) : null;
  }

  async save(record: IdempotencyRecord): Promise<void> {
    const existing = this.records.get(key(record.actorId, record.operation, record.idempotencyKey));
    if (existing && existing.requestHash !== record.requestHash) {
      throw conflict(
        'OPTIC-WF-40906',
        'This request was already processed with a different body. Use a new idempotency key.'
      );
    }
    if (!existing) {
      this.records.set(key(record.actorId, record.operation, record.idempotencyKey), structuredClone(record));
    }
  }
}

function key(actorId: string, operation: string, idempotencyKey: string): string {
  return `${actorId}::${operation}::${idempotencyKey}`;
}
