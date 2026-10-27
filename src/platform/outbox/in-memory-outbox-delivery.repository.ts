import type {
  ClaimDueDeliveriesInput,
  FailDeliveryInput,
  OutboxConsumerKey,
  OutboxDeliveryRecord,
  OutboxDeliveryRepository,
  RetryDeliveryInput
} from './outbox-delivery.repository.js';
import { truncateError } from './backoff.js';

export class InMemoryOutboxDeliveryRepository implements OutboxDeliveryRepository {
  readonly rows: OutboxDeliveryRecord[] = [];
  private nextId = 1;

  async ensurePending(eventId: string, consumerKey: OutboxConsumerKey): Promise<void> {
    if (this.rows.some((row) => row.eventId === eventId && row.consumerKey === consumerKey)) {
      return;
    }
    const now = new Date();
    this.rows.push({
      id: this.nextId++,
      eventId,
      consumerKey,
      status: 'PENDING',
      attemptCount: 0,
      nextAttemptAt: now,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: null,
      publishedAt: null,
      createdAt: now
    });
  }

  async claimDue(input: ClaimDueDeliveriesInput): Promise<OutboxDeliveryRecord[]> {
    const now = Date.now();
    const claimed: OutboxDeliveryRecord[] = [];
    const expires = new Date(now + input.leaseMs);
    for (const row of this.rows) {
      if (claimed.length >= input.limit) {
        break;
      }
      if (row.consumerKey !== input.consumerKey || row.status !== 'PENDING') {
        continue;
      }
      if (row.nextAttemptAt.getTime() > now) {
        continue;
      }
      if (row.leaseOwner && row.leaseExpiresAt && row.leaseExpiresAt.getTime() > now) {
        continue;
      }
      row.leaseOwner = input.owner;
      row.leaseExpiresAt = expires;
      claimed.push(structuredClone(row));
    }
    return claimed;
  }

  async markPublished(id: number, leaseOwner: string): Promise<boolean> {
    const row = this.rows.find((item) => item.id === id);
    if (!row || row.status !== 'PENDING' || row.leaseOwner !== leaseOwner) {
      return false;
    }
    row.status = 'PUBLISHED';
    row.publishedAt = new Date();
    row.leaseOwner = null;
    row.leaseExpiresAt = null;
    row.lastError = null;
    return true;
  }

  async retry(input: RetryDeliveryInput): Promise<boolean> {
    const row = this.rows.find((item) => item.id === input.id);
    if (!row || row.status !== 'PENDING' || row.leaseOwner !== input.leaseOwner) {
      return false;
    }
    row.attemptCount += 1;
    row.nextAttemptAt = input.nextAttemptAt;
    row.lastError = truncateError(input.errorMessage);
    row.leaseOwner = null;
    row.leaseExpiresAt = null;
    return true;
  }

  async fail(input: FailDeliveryInput): Promise<boolean> {
    const row = this.rows.find((item) => item.id === input.id);
    if (!row || row.status !== 'PENDING' || row.leaseOwner !== input.leaseOwner) {
      return false;
    }
    row.status = 'DEAD_LETTER';
    row.attemptCount += 1;
    row.lastError = truncateError(input.errorMessage);
    row.leaseOwner = null;
    row.leaseExpiresAt = null;
    return true;
  }

  async abandonLeases(owner: string): Promise<number> {
    let count = 0;
    for (const row of this.rows) {
      if (row.leaseOwner === owner && row.status === 'PENDING') {
        row.leaseOwner = null;
        row.leaseExpiresAt = null;
        count += 1;
      }
    }
    return count;
  }

  async listByEventId(eventId: string): Promise<OutboxDeliveryRecord[]> {
    return this.rows.filter((row) => row.eventId === eventId).map((row) => structuredClone(row));
  }

  async redriveDeadLetters(consumerKey?: OutboxConsumerKey): Promise<number> {
    const now = new Date();
    let count = 0;
    for (const row of this.rows) {
      if (row.status !== 'DEAD_LETTER') {
        continue;
      }
      if (consumerKey && row.consumerKey !== consumerKey) {
        continue;
      }
      row.status = 'PENDING';
      row.attemptCount = 0;
      row.nextAttemptAt = now;
      row.lastError = null;
      row.leaseOwner = null;
      row.leaseExpiresAt = null;
      row.publishedAt = null;
      count += 1;
    }
    return count;
  }
}
