import type { QueryExecutor } from '../db/types.js';

export interface SplunkEventRecord {
  id?: number;
  eventId: string;
  eventType: string;
  occurredAt: Date;
  correlationId: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export interface AppendSplunkEventInput {
  eventId: string;
  eventType: string;
  occurredAt: Date;
  correlationId: string;
  payload: Record<string, unknown>;
}

export interface SplunkEventRepository {
  append(input: AppendSplunkEventInput, executor?: QueryExecutor): Promise<SplunkEventRecord>;
  findByEventId(eventId: string, executor?: QueryExecutor): Promise<SplunkEventRecord | null>;
  listByCorrelationId(correlationId: string, executor?: QueryExecutor): Promise<SplunkEventRecord[]>;
}

export interface SplunkSink {
  emit(event: AppendSplunkEventInput): Promise<void>;
}
