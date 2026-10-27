import type { QueryExecutor } from '../db/types.js';

export type OutboxConsumerKey = 'AUDIT' | 'SPLUNK';
export type OutboxDeliveryStatus = 'PENDING' | 'PUBLISHED' | 'DEAD_LETTER';

export interface OutboxDeliveryRecord {
  id: number;
  eventId: string;
  consumerKey: OutboxConsumerKey;
  status: OutboxDeliveryStatus;
  attemptCount: number;
  nextAttemptAt: Date;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  lastError: string | null;
  publishedAt: Date | null;
  createdAt: Date;
}

export interface ClaimDueDeliveriesInput {
  consumerKey: OutboxConsumerKey;
  owner: string;
  leaseMs: number;
  limit: number;
}

export interface RetryDeliveryInput {
  id: number;
  leaseOwner: string;
  nextAttemptAt: Date;
  errorMessage: string;
}

export interface FailDeliveryInput {
  id: number;
  leaseOwner: string;
  errorMessage: string;
}

export interface OutboxDeliveryRepository {
  ensurePending(eventId: string, consumerKey: OutboxConsumerKey, executor?: QueryExecutor): Promise<void>;
  claimDue(input: ClaimDueDeliveriesInput): Promise<OutboxDeliveryRecord[]>;
  markPublished(id: number, leaseOwner: string, executor?: QueryExecutor): Promise<boolean>;
  retry(input: RetryDeliveryInput, executor?: QueryExecutor): Promise<boolean>;
  fail(input: FailDeliveryInput, executor?: QueryExecutor): Promise<boolean>;
  abandonLeases(owner: string, executor?: QueryExecutor): Promise<number>;
  listByEventId(eventId: string, executor?: QueryExecutor): Promise<OutboxDeliveryRecord[]>;
  redriveDeadLetters(consumerKey?: OutboxConsumerKey, executor?: QueryExecutor): Promise<number>;
}
