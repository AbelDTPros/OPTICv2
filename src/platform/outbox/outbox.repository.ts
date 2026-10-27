import type { QueryExecutor } from '../db/types.js';

export type OutboxPublishStatus = 'PENDING' | 'PUBLISHED' | 'FAILED' | 'DEAD_LETTER';

export interface OutboxEventRecord {
  eventId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  eventVersion: number;
  occurredAt: Date;
  correlationId: string;
  sessionId: string | null;
  actorId: string | null;
  payload: Record<string, unknown>;
  publishStatus: OutboxPublishStatus;
  publishAttempts: number;
  publishedAt: Date | null;
  lastError: string | null;
}

export interface AppendOutboxEventInput {
  eventId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  eventVersion?: number;
  correlationId: string;
  sessionId?: string | null;
  actorId?: string | null;
  payload: Record<string, unknown>;
}

export interface OutboxRepository {
  append(input: AppendOutboxEventInput, executor?: QueryExecutor): Promise<OutboxEventRecord>;
  listByAggregate(
    aggregateType: string,
    aggregateId: string,
    executor?: QueryExecutor
  ): Promise<OutboxEventRecord[]>;
  findByEventId(eventId: string, executor?: QueryExecutor): Promise<OutboxEventRecord | null>;
  withWriteLock<T>(work: (executor?: QueryExecutor) => Promise<T>): Promise<T>;
  claimPending(limit: number, executor?: QueryExecutor): Promise<OutboxEventRecord[]>;
  markPublished(eventId: string, executor?: QueryExecutor): Promise<void>;
  markPublishFailed(
    eventId: string,
    errorMessage: string,
    maxAttempts: number,
    executor?: QueryExecutor
  ): Promise<'RETRIED' | 'DEAD_LETTER'>;
  redriveDeadLetters(executor?: QueryExecutor): Promise<number>;
}
