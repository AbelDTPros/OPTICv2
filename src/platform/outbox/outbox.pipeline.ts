import type { OutboxPublisherConfig } from '../../config/env.js';
import type { AuditEventRepository } from '../audit/audit-event.repository.js';
import { mapOutboxToAuditInput } from '../audit/map-audit-event.js';
import { log, logError } from '../logging/logger.js';
import type { OutboxDeliveryRecord, OutboxDeliveryRepository } from './outbox-delivery.repository.js';
import type { OutboxEventRecord, OutboxRepository } from './outbox.repository.js';
import { nextRetryAt } from './backoff.js';
import { projectPayloadForSplunk } from '../splunk/mask.js';
import { RepositorySplunkSink } from '../splunk/repository-splunk.sink.js';
import type { SplunkEventRepository, SplunkSink } from '../splunk/splunk-event.repository.js';

const CONSUMERS = ['AUDIT', 'SPLUNK'] as const;

export interface OutboxPipelineTickResult {
  published: number;
  publishRetried: number;
  publishFailed: number;
  auditPublished: number;
  auditRetried: number;
  auditFailed: number;
  splunkPublished: number;
  splunkRetried: number;
  splunkFailed: number;
}

export class OutboxPipeline {
  private stopped = false;
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> = Promise.resolve();
  private readonly splunkSink: SplunkSink;

  constructor(
    private readonly outbox: OutboxRepository,
    private readonly deliveries: OutboxDeliveryRepository,
    private readonly audit: AuditEventRepository,
    private readonly splunk: SplunkEventRepository,
    private readonly config: OutboxPublisherConfig,
    options?: { splunkSink?: SplunkSink }
  ) {
    this.splunkSink = options?.splunkSink ?? new RepositorySplunkSink(splunk);
  }

  start(): void {
    if (!this.config.enabled) {
      log('info', 'Outbox publisher disabled', { event: 'outbox.publisher_disabled' });
      return;
    }
    this.stopped = false;
    log('info', 'Outbox publisher started', {
      event: 'outbox.publisher_started',
      workerId: this.config.workerId,
      pollIntervalMs: this.config.pollIntervalMs,
      batchSize: this.config.batchSize
    });
    this.timer = setInterval(() => {
      this.inFlight = this.inFlight.then(() => this.runTick()).catch((error: unknown) => {
        logError('Outbox pipeline tick failed', error, {
          event: 'outbox.tick_failed',
          workerId: this.config.workerId
        });
      });
    }, this.config.pollIntervalMs);
    this.timer.unref();
    this.inFlight = this.runTick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    await this.inFlight;
    const abandoned = await this.deliveries.abandonLeases(this.config.workerId);
    log('info', 'Outbox publisher stopped', {
      event: 'outbox.publisher_stopped',
      workerId: this.config.workerId,
      abandoned
    });
  }

  async tick(): Promise<OutboxPipelineTickResult> {
    return this.processBatch();
  }

  async redriveDeadLetters(consumerKey?: 'AUDIT' | 'SPLUNK'): Promise<{ outbox: number; deliveries: number }> {
    const outbox = await this.outbox.redriveDeadLetters();
    const deliveries = await this.deliveries.redriveDeadLetters(consumerKey);
    log('info', 'Dead-lettered outbox deliveries redriven', {
      event: 'outbox.redriven',
      workerId: this.config.workerId,
      outbox,
      deliveries,
      consumerKey: consumerKey ?? 'ALL'
    });
    return { outbox, deliveries };
  }

  private async runTick(): Promise<void> {
    if (this.stopped) {
      return;
    }
    await this.processBatch();
  }

  private async processBatch(): Promise<OutboxPipelineTickResult> {
    const result: OutboxPipelineTickResult = {
      published: 0,
      publishRetried: 0,
      publishFailed: 0,
      auditPublished: 0,
      auditRetried: 0,
      auditFailed: 0,
      splunkPublished: 0,
      splunkRetried: 0,
      splunkFailed: 0
    };
    if (this.stopped) {
      return result;
    }
    await this.publishPending(result);
    if (!this.stopped) {
      await this.consumeAudit(result);
    }
    if (!this.stopped) {
      await this.consumeSplunk(result);
    }
    return result;
  }

  private async publishPending(result: OutboxPipelineTickResult): Promise<void> {
    for (let index = 0; index < this.config.batchSize; index += 1) {
      if (this.stopped) {
        break;
      }
      const outcome = await this.outbox.withWriteLock(async (executor) => {
        const [event] = await this.outbox.claimPending(1, executor);
        if (!event) {
          return null;
        }
        try {
          for (const consumer of CONSUMERS) {
            await this.deliveries.ensurePending(event.eventId, consumer, executor);
          }
          await this.outbox.markPublished(event.eventId, executor);
          return { event, disposition: 'PUBLISHED' as const };
        } catch (error: unknown) {
          const disposition = await this.outbox.markPublishFailed(
            event.eventId,
            errorMessage(error),
            this.config.defaultMaxAttempts,
            executor
          );
          return { event, disposition, error };
        }
      });
      if (!outcome) {
        break;
      }
      if (outcome.disposition === 'PUBLISHED') {
        result.published += 1;
        log('info', 'Outbox event handed to consumers', {
          event: 'outbox.published',
          workerId: this.config.workerId,
          eventId: outcome.event.eventId,
          eventType: outcome.event.eventType,
          correlationId: outcome.event.correlationId
        });
        continue;
      }
      if (outcome.disposition === 'DEAD_LETTER') {
        result.publishFailed += 1;
      } else {
        result.publishRetried += 1;
      }
      logError('Outbox publish failed', 'error' in outcome ? outcome.error : 'unknown', {
        event: 'outbox.publish_failed',
        workerId: this.config.workerId,
        eventId: outcome.event.eventId,
        eventType: outcome.event.eventType,
        correlationId: outcome.event.correlationId,
        disposition: outcome.disposition,
        errorCode: 'OPTIC-SYS-50010'
      });
    }
  }

  private async consumeAudit(result: OutboxPipelineTickResult): Promise<void> {
    const claimed = await this.deliveries.claimDue({
      consumerKey: 'AUDIT',
      owner: this.config.workerId,
      leaseMs: this.config.leaseMs,
      limit: this.config.batchSize
    });
    for (const delivery of claimed) {
      if (this.stopped) {
        break;
      }
      try {
        const event = await this.requireOutboxEvent(delivery);
        await this.audit.append(mapOutboxToAuditInput(event));
        const published = await this.deliveries.markPublished(delivery.id, this.config.workerId);
        if (published) {
          result.auditPublished += 1;
          log('info', 'Audit event written', {
            event: 'audit.written',
            workerId: this.config.workerId,
            eventId: event.eventId,
            eventType: event.eventType,
            correlationId: event.correlationId
          });
        }
      } catch (error: unknown) {
        const disposition = await this.retryOrFail(delivery, error);
        if (disposition === 'DEAD_LETTER') {
          result.auditFailed += 1;
        } else if (disposition === 'RETRIED') {
          result.auditRetried += 1;
        }
        logError('Audit consumer failed', error, {
          event: 'audit.failed',
          workerId: this.config.workerId,
          eventId: delivery.eventId,
          disposition,
          errorCode: 'OPTIC-SYS-50011'
        });
      }
    }
  }

  private async consumeSplunk(result: OutboxPipelineTickResult): Promise<void> {
    const claimed = await this.deliveries.claimDue({
      consumerKey: 'SPLUNK',
      owner: this.config.workerId,
      leaseMs: this.config.leaseMs,
      limit: this.config.batchSize
    });
    for (const delivery of claimed) {
      if (this.stopped) {
        break;
      }
      try {
        const event = await this.requireOutboxEvent(delivery);
        const masked = projectPayloadForSplunk(event.payload);
        await this.splunkSink.emit({
          eventId: event.eventId,
          eventType: event.eventType,
          occurredAt: event.occurredAt,
          correlationId: event.correlationId,
          payload: masked
        });
        const published = await this.deliveries.markPublished(delivery.id, this.config.workerId);
        if (published) {
          result.splunkPublished += 1;
        }
      } catch (error: unknown) {
        const disposition = await this.retryOrFail(delivery, error);
        if (disposition === 'DEAD_LETTER') {
          result.splunkFailed += 1;
        } else if (disposition === 'RETRIED') {
          result.splunkRetried += 1;
        }
        logError('Splunk consumer failed', error, {
          event: 'splunk.failed',
          workerId: this.config.workerId,
          eventId: delivery.eventId,
          disposition,
          errorCode: 'OPTIC-SYS-50012'
        });
      }
    }
  }

  private async requireOutboxEvent(delivery: OutboxDeliveryRecord): Promise<OutboxEventRecord> {
    const event = await this.outbox.findByEventId(delivery.eventId);
    if (!event) {
      throw new Error(`Outbox event ${delivery.eventId} was not found.`);
    }
    return event;
  }

  private async retryOrFail(
    delivery: OutboxDeliveryRecord,
    error: unknown
  ): Promise<'RETRIED' | 'DEAD_LETTER' | 'SKIPPED'> {
    const message = errorMessage(error);
    const nextAttempt = delivery.attemptCount + 1;
    if (nextAttempt >= this.config.defaultMaxAttempts) {
      const failed = await this.deliveries.fail({
        id: delivery.id,
        leaseOwner: this.config.workerId,
        errorMessage: message
      });
      return failed ? 'DEAD_LETTER' : 'SKIPPED';
    }
    const retried = await this.deliveries.retry({
      id: delivery.id,
      leaseOwner: this.config.workerId,
      nextAttemptAt: nextRetryAt(nextAttempt, 'EXPONENTIAL', this.config.backoffBaseMs),
      errorMessage: message
    });
    return retried ? 'RETRIED' : 'SKIPPED';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown';
}
