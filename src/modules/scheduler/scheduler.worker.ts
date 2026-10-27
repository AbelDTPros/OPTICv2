import type { SchedulerConfig } from '../../config/env.js';
import { AppError } from '../../platform/errors/app-error.js';
import { log, logError } from '../../platform/logging/logger.js';
import { schedulerActor } from '../../platform/security/actor.js';
import type { WorkflowInstanceService } from '../workflow/service/workflow-instance.service.js';

export interface SchedulerTickResult {
  claimed: number;
  completed: number;
  skipped: number;
  retried: number;
  failed: number;
}

export class SchedulerWorker {
  private stopped = false;
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> = Promise.resolve();

  constructor(
    private readonly workflow: WorkflowInstanceService,
    private readonly config: SchedulerConfig
  ) {}

  start(): void {
    if (!this.config.enabled) {
      log('info', 'Scheduler worker disabled', { event: 'scheduler.disabled' });
      return;
    }
    this.stopped = false;
    log('info', 'Scheduler worker started', {
      event: 'scheduler.started',
      workerId: this.config.workerId,
      pollIntervalMs: this.config.pollIntervalMs,
      batchSize: this.config.batchSize
    });
    this.timer = setInterval(() => {
      this.inFlight = this.inFlight.then(() => this.runTick()).catch((error: unknown) => {
        logError('Scheduler tick failed', error, {
          event: 'scheduler.tick_failed',
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
    const abandoned = await this.workflow.abandonScheduledLeases(this.config.workerId);
    log('info', 'Scheduler worker stopped', {
      event: 'scheduler.stopped',
      workerId: this.config.workerId,
      abandoned
    });
  }

  async tick(): Promise<SchedulerTickResult> {
    return this.processBatch();
  }

  private async runTick(): Promise<void> {
    if (this.stopped) {
      return;
    }
    await this.processBatch();
  }

  private async processBatch(): Promise<SchedulerTickResult> {
    const result: SchedulerTickResult = {
      claimed: 0,
      completed: 0,
      skipped: 0,
      retried: 0,
      failed: 0
    };
    if (this.stopped) {
      return result;
    }
    const claimed = await this.workflow.claimDueScheduledActions(
      this.config.workerId,
      this.config.leaseMs,
      this.config.batchSize
    );
    result.claimed = claimed.length;
    for (const row of claimed) {
      if (this.stopped) {
        break;
      }
      const actor = schedulerActor();
      try {
        const outcome = await this.workflow.executeScheduledAction(actor, {
          scheduledActionId: row.id,
          leaseOwner: this.config.workerId
        });
        if (outcome === 'COMPLETED') {
          result.completed += 1;
        } else {
          result.skipped += 1;
        }
        log('info', 'Scheduled action processed', {
          event: 'scheduler.action_processed',
          workerId: this.config.workerId,
          scheduledActionId: row.id,
          scheduledActionKey: row.scheduledActionKey,
          workflowInstanceId: row.workflowInstanceId,
          outcome
        });
      } catch (error: unknown) {
        if (error instanceof AppError && error.errorCode === 'OPTIC-WF-40907') {
          result.skipped += 1;
          continue;
        }
        const disposition = await this.workflow.retryOrFailScheduledAction(
          actor,
          row,
          this.config.workerId,
          error,
          {
            maxAttempts: this.config.defaultMaxAttempts,
            backoffBaseMs: this.config.backoffBaseMs
          }
        );
        if (disposition === 'DEAD_LETTER') {
          result.failed += 1;
        } else if (disposition === 'RETRIED') {
          result.retried += 1;
        } else {
          result.skipped += 1;
        }
        logError('Scheduled action execution failed', error, {
          event: 'scheduler.action_failed',
          workerId: this.config.workerId,
          scheduledActionId: row.id,
          scheduledActionKey: row.scheduledActionKey,
          workflowInstanceId: row.workflowInstanceId,
          disposition,
          errorCode: error instanceof AppError ? error.errorCode : 'OPTIC-SYS-50001'
        });
      }
    }
    return result;
  }
}
