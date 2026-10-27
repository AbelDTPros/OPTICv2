import type { QueryExecutor } from '../db/types.js';
import type {
  AppendOutboxEventInput,
  OutboxEventRecord,
  OutboxRepository
} from './outbox.repository.js';
import { truncateError } from './backoff.js';

export class InMemoryOutboxRepository implements OutboxRepository {
  readonly events: OutboxEventRecord[] = [];
  private writeLock: Promise<void> = Promise.resolve();

  async append(input: AppendOutboxEventInput): Promise<OutboxEventRecord> {
    const record: OutboxEventRecord = {
      eventId: input.eventId,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      eventVersion: input.eventVersion ?? 1,
      occurredAt: new Date(),
      correlationId: input.correlationId,
      sessionId: input.sessionId ?? null,
      actorId: input.actorId ?? null,
      payload: structuredClone(input.payload),
      publishStatus: 'PENDING',
      publishAttempts: 0,
      publishedAt: null,
      lastError: null
    };
    this.events.push(record);
    return structuredClone(record);
  }

  async listByAggregate(aggregateType: string, aggregateId: string): Promise<OutboxEventRecord[]> {
    return this.events
      .filter((event) => event.aggregateType === aggregateType && event.aggregateId === aggregateId)
      .map((event) => structuredClone(event));
  }

  async findByEventId(eventId: string): Promise<OutboxEventRecord | null> {
    const event = this.events.find((row) => row.eventId === eventId);
    return event ? structuredClone(event) : null;
  }

  async withWriteLock<T>(work: (executor?: QueryExecutor) => Promise<T>): Promise<T> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.writeLock;
    this.writeLock = next;
    await previous;
    try {
      return await work(undefined);
    } finally {
      release();
    }
  }

  async claimPending(limit: number): Promise<OutboxEventRecord[]> {
    const claimed: OutboxEventRecord[] = [];
    for (const event of this.events) {
      if (event.publishStatus === 'PENDING' && claimed.length < limit) {
        claimed.push(structuredClone(event));
      }
    }
    return claimed;
  }

  async markPublished(eventId: string): Promise<void> {
    const event = this.events.find((row) => row.eventId === eventId);
    if (!event) {
      return;
    }
    event.publishStatus = 'PUBLISHED';
    event.publishedAt = new Date();
    event.lastError = null;
  }

  async markPublishFailed(
    eventId: string,
    errorMessage: string,
    maxAttempts: number
  ): Promise<'RETRIED' | 'DEAD_LETTER'> {
    const event = this.events.find((row) => row.eventId === eventId);
    if (!event) {
      return 'RETRIED';
    }
    event.publishAttempts += 1;
    event.lastError = truncateError(errorMessage);
    if (event.publishAttempts >= maxAttempts) {
      event.publishStatus = 'DEAD_LETTER';
      return 'DEAD_LETTER';
    }
    event.publishStatus = 'PENDING';
    return 'RETRIED';
  }

  async redriveDeadLetters(): Promise<number> {
    let count = 0;
    for (const event of this.events) {
      if (event.publishStatus === 'DEAD_LETTER') {
        event.publishStatus = 'PENDING';
        event.publishAttempts = 0;
        event.lastError = null;
        event.publishedAt = null;
        count += 1;
      }
    }
    return count;
  }
}
