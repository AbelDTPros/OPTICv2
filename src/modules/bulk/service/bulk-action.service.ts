import type { QueryExecutor } from '../../../platform/db/types.js';
import { AppError, notFound, validationFailed } from '../../../platform/errors/app-error.js';
import { log } from '../../../platform/logging/logger.js';
import { createBulkOutboxEvent } from '../../../platform/outbox/bulk-events.js';
import type { OutboxRepository } from '../../../platform/outbox/outbox.repository.js';
import type { ActorContext } from '../../../platform/security/actor.js';
import type { AuthorizationPort } from '../../../platform/security/authorization-port.js';
import { compileBusinessSchema } from '../../configuration/definitions/schema-compiler.js';
import type { DefinitionLoader } from '../../configuration/definitions/definition-loader.js';
import type { BulkActionDefinition } from '../../configuration/domain/types.js';
import type { TransactionRunner, WorkflowInstanceService } from '../../workflow/service/workflow-instance.service.js';
import type {
  BulkItemStatus,
  BulkOperationItemRecord,
  BulkOperationRecord,
  BulkOperationStatus
} from '../domain/types.js';
import type { BulkOperationRepository } from '../persistence/bulk-operation.repository.js';

export interface BulkExecuteItem {
  entityType: string;
  trackingId: string;
  expectedRowVersion: number;
}

export interface ExecuteBulkActionCommand {
  bulkActionKey: string;
  items: BulkExecuteItem[];
  input?: Record<string, unknown>;
}

export interface BulkOperationView {
  id: number;
  bulkActionKey: string;
  definitionKey: string;
  version: string;
  transactionMode: 'ATOMIC' | 'BEST_EFFORT';
  status: BulkOperationStatus;
  totalItems: number;
  successfulItems: number;
  failedItems: number;
  input: Record<string, unknown>;
  createdAt: string;
  completedAt: string | null;
  items: Array<{
    workflowInstanceId: number;
    trackingId: string;
    status: BulkItemStatus;
    errorCode: string | null;
    errorMessage: string | null;
    completedAt: string | null;
  }>;
}

export class BulkActionService {
  constructor(
    private readonly workflow: WorkflowInstanceService,
    private readonly loader: DefinitionLoader,
    private readonly operations: BulkOperationRepository,
    private readonly outbox: OutboxRepository,
    private readonly authorization: AuthorizationPort,
    private readonly runInTransaction: TransactionRunner
  ) {}

  async execute(actor: ActorContext, command: ExecuteBulkActionCommand): Promise<BulkOperationView> {
    await this.authorization.assertCanExecuteBulkAction(actor, command.bulkActionKey);
    const items = uniqueItems(command.items);
    if (items.length === 0) {
      throw validationFailed('OPTIC-WF-40081', 'Select at least one item.', [
        { field: 'items', path: 'items', message: 'Required' }
      ]);
    }

    const summaries = [];
    for (const item of items) {
      summaries.push(await this.workflow.getSummary(actor, item.entityType, item.trackingId));
    }
    const releaseIds = new Set(summaries.map((item) => item.definition.releaseId));
    if (releaseIds.size !== 1) {
      throw validationFailed(
        'OPTIC-WF-40083',
        'Bulk actions can only run against items pinned to the same definition release.'
      );
    }
    const compiled = await this.loader.loadByReleaseId(Number(summaries[0]?.definition.releaseId));
    const bulk = compiled.release.bulkActions[command.bulkActionKey];
    if (!bulk) {
      throw validationFailed(
        'OPTIC-WF-40080',
        `Bulk action ${command.bulkActionKey} is not defined on the pinned release.`
      );
    }
    if (items.length > bulk.maxSelection) {
      throw validationFailed(
        'OPTIC-WF-40082',
        `Bulk action ${bulk.bulkActionKey} allows at most ${bulk.maxSelection} items.`,
        [{ field: 'items', path: 'items', message: `Select ${bulk.maxSelection} or fewer items.` }]
      );
    }
    const input = command.input ?? {};
    assertSharedInput(bulk, input);

    const result =
      bulk.transactionMode === 'ATOMIC'
        ? await this.executeAtomic(actor, compiled.definitionKey, compiled.version, bulk, items, input)
        : await this.executeBestEffort(actor, compiled.definitionKey, compiled.version, bulk, items, input);

    log('info', 'Bulk action completed', {
      event: 'bulk.completed',
      bulkActionKey: bulk.bulkActionKey,
      bulkOperationId: result.id,
      transactionMode: bulk.transactionMode,
      status: result.status,
      successfulItems: result.successfulItems,
      failedItems: result.failedItems
    });
    return result;
  }

  async getOperation(actor: ActorContext, id: number): Promise<BulkOperationView> {
    await this.authorization.assertCanReadBulkOperation(actor);
    const operation = await this.operations.findById(id);
    if (!operation) {
      throw notFound('OPTIC-WF-40430', `Bulk operation ${id} was not found.`);
    }
    const compiled = await this.loader.loadByReleaseId(operation.definitionReleaseId);
    const items = await this.operations.listItems(id);
    return toView(operation, items, compiled.definitionKey, compiled.version);
  }

  private async executeAtomic(
    actor: ActorContext,
    definitionKey: string,
    version: string,
    bulk: BulkActionDefinition,
    items: BulkExecuteItem[],
    input: Record<string, unknown>
  ): Promise<BulkOperationView> {
    return this.runInTransaction(async (executor) => {
      const { operation, createdItems } = await this.startOperation(
        actor,
        definitionKey,
        version,
        bulk,
        items,
        input,
        executor
      );
      for (const [index, item] of items.entries()) {
        await this.workflow.applyBulkItem(
          actor,
          {
            entityType: item.entityType,
            entityTrackingId: item.trackingId,
            bulkActionKey: bulk.bulkActionKey,
            expectedRowVersion: item.expectedRowVersion,
            input
          },
          executor
        );
        const persisted = createdItems[index];
        if (!persisted) {
          continue;
        }
        await this.completeItem(actor, definitionKey, version, bulk, operation, persisted, 'SUCCEEDED', executor);
      }
      const completed = await this.finishOperation(
        actor,
        definitionKey,
        version,
        bulk,
        operation,
        items.length,
        0,
        executor
      );
      return toView(completed, await this.operations.listItems(operation.id, executor), definitionKey, version);
    });
  }

  private async executeBestEffort(
    actor: ActorContext,
    definitionKey: string,
    version: string,
    bulk: BulkActionDefinition,
    items: BulkExecuteItem[],
    input: Record<string, unknown>
  ): Promise<BulkOperationView> {
    const started = await this.runInTransaction(async (executor) =>
      this.startOperation(actor, definitionKey, version, bulk, items, input, executor)
    );
    let successful = 0;
    let failed = 0;
    for (const [index, item] of items.entries()) {
      const persisted = started.createdItems[index];
      if (!persisted) {
        continue;
      }
      try {
        await this.runInTransaction(async (executor) => {
          await this.workflow.applyBulkItem(
            actor,
            {
              entityType: item.entityType,
              entityTrackingId: item.trackingId,
              bulkActionKey: bulk.bulkActionKey,
              expectedRowVersion: item.expectedRowVersion,
              input
            },
            executor
          );
          await this.completeItem(actor, definitionKey, version, bulk, started.operation, persisted, 'SUCCEEDED', executor);
        });
        successful += 1;
      } catch (error: unknown) {
        const fields = itemErrorFields(error);
        await this.runInTransaction(async (executor) => {
          await this.completeItem(
            actor,
            definitionKey,
            version,
            bulk,
            started.operation,
            persisted,
            'FAILED',
            executor,
            fields
          );
        });
        failed += 1;
      }
    }
    const completed = await this.runInTransaction(async (executor) =>
      this.finishOperation(actor, definitionKey, version, bulk, started.operation, successful, failed, executor)
    );
    return toView(completed, await this.operations.listItems(started.operation.id), definitionKey, version);
  }

  private async startOperation(
    actor: ActorContext,
    definitionKey: string,
    version: string,
    bulk: BulkActionDefinition,
    items: BulkExecuteItem[],
    input: Record<string, unknown>,
    executor?: QueryExecutor
  ): Promise<{ operation: BulkOperationRecord; createdItems: BulkOperationItemRecord[] }> {
    const first = await this.workflow.getSummary(actor, items[0]?.entityType ?? 'WORKLOAD', items[0]?.trackingId ?? '');
    const operation = await this.operations.createOperation(
      {
        bulkActionKey: bulk.bulkActionKey,
        definitionReleaseId: Number(first.definition.releaseId),
        initiatedBy: actor.actorId,
        sessionId: actor.sessionId ?? '',
        correlationId: actor.correlationId ?? `c-bulk-${crypto.randomUUID()}`,
        transactionMode: bulk.transactionMode,
        input,
        totalItems: items.length
      },
      executor
    );
    const createdItems: BulkOperationItemRecord[] = [];
    for (const item of items) {
      const summary = await this.workflow.getSummary(actor, item.entityType, item.trackingId);
      createdItems.push(
        await this.operations.createItem(
          {
            bulkOperationId: operation.id,
            workflowInstanceId: summary.workflowInstanceId,
            entityTrackingId: item.trackingId
          },
          executor
        )
      );
    }
    await this.outbox.append(
      createBulkOutboxEvent({
        actor,
        eventType: 'BULK_ACTION_STARTED',
        bulkOperationId: operation.id,
        bulkActionKey: bulk.bulkActionKey,
        definitionKey,
        definitionVersion: version,
        transactionMode: bulk.transactionMode,
        totalItems: items.length
      }),
      executor
    );
    return { operation, createdItems };
  }

  private async completeItem(
    actor: ActorContext,
    definitionKey: string,
    version: string,
    bulk: BulkActionDefinition,
    operation: BulkOperationRecord,
    item: BulkOperationItemRecord,
    status: 'SUCCEEDED' | 'FAILED',
    executor?: QueryExecutor,
    error?: { errorCode: string; errorMessage: string }
  ): Promise<void> {
    await this.operations.completeItem(
      {
        itemId: item.id,
        status,
        errorCode: error?.errorCode ?? null,
        errorMessage: error?.errorMessage ?? null
      },
      executor
    );
    await this.outbox.append(
      createBulkOutboxEvent({
        actor,
        eventType: status === 'SUCCEEDED' ? 'BULK_ITEM_SUCCEEDED' : 'BULK_ITEM_FAILED',
        bulkOperationId: operation.id,
        bulkActionKey: bulk.bulkActionKey,
        definitionKey,
        definitionVersion: version,
        transactionMode: bulk.transactionMode,
        entityTrackingId: item.entityTrackingId,
        workflowInstanceId: item.workflowInstanceId,
        status,
        errorCode: error?.errorCode ?? null
      }),
      executor
    );
  }

  private async finishOperation(
    actor: ActorContext,
    definitionKey: string,
    version: string,
    bulk: BulkActionDefinition,
    operation: BulkOperationRecord,
    successfulItems: number,
    failedItems: number,
    executor?: QueryExecutor
  ): Promise<BulkOperationRecord> {
    const status: Exclude<BulkOperationStatus, 'PENDING'> =
      failedItems === 0 ? 'COMPLETED' : successfulItems === 0 ? 'FAILED' : 'PARTIAL';
    const completed = await this.operations.completeOperation(
      {
        operationId: operation.id,
        status,
        successfulItems,
        failedItems
      },
      executor
    );
    await this.outbox.append(
      createBulkOutboxEvent({
        actor,
        eventType: 'BULK_ACTION_COMPLETED',
        bulkOperationId: operation.id,
        bulkActionKey: bulk.bulkActionKey,
        definitionKey,
        definitionVersion: version,
        transactionMode: bulk.transactionMode,
        status,
        successfulItems,
        failedItems,
        totalItems: operation.totalItems
      }),
      executor
    );
    return completed;
  }
}

function uniqueItems(items: BulkExecuteItem[]): BulkExecuteItem[] {
  const seen = new Set<string>();
  const unique: BulkExecuteItem[] = [];
  for (const item of items) {
    const key = `${item.entityType}:${item.trackingId}`;
    if (seen.has(key)) {
      throw validationFailed('OPTIC-WF-40081', 'Duplicate items are not allowed in a bulk selection.', [
        { field: 'trackingId', path: 'items.trackingId', message: `${item.trackingId} was selected more than once.` }
      ]);
    }
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function assertSharedInput(bulk: BulkActionDefinition, input: Record<string, unknown>): void {
  if (!bulk.sharedInputSchema || Object.keys(bulk.sharedInputSchema).length === 0) {
    return;
  }
  const result = compileBusinessSchema(bulk.sharedInputSchema).validate(input);
  if (result.valid) {
    return;
  }
  throw validationFailed(
    'OPTIC-WF-40086',
    'Shared bulk input is not valid. Review the highlighted fields and try again.',
    result.errors.map((error) => ({
      field: error.path.replace(/^\//, '') || 'input',
      path: error.path,
      message: error.message
    }))
  );
}

function itemErrorFields(error: unknown): { errorCode: string; errorMessage: string } {
  if (error instanceof AppError) {
    return { errorCode: error.errorCode, errorMessage: error.message.slice(0, 1000) };
  }
  if (error instanceof Error) {
    return { errorCode: 'OPTIC-SYS-50001', errorMessage: error.message.slice(0, 1000) };
  }
  return { errorCode: 'OPTIC-SYS-50001', errorMessage: 'Bulk item failed.' };
}

function toView(
  operation: BulkOperationRecord,
  items: BulkOperationItemRecord[],
  definitionKey: string,
  version: string
): BulkOperationView {
  return {
    id: operation.id,
    bulkActionKey: operation.bulkActionKey,
    definitionKey,
    version,
    transactionMode: operation.transactionMode,
    status: operation.status,
    totalItems: operation.totalItems,
    successfulItems: operation.successfulItems,
    failedItems: operation.failedItems,
    input: operation.input,
    createdAt: operation.createdAt.toISOString(),
    completedAt: operation.completedAt ? operation.completedAt.toISOString() : null,
    items: items.map((item) => ({
      workflowInstanceId: item.workflowInstanceId,
      trackingId: item.entityTrackingId,
      status: item.status,
      errorCode: item.errorCode,
      errorMessage: item.errorMessage,
      completedAt: item.completedAt ? item.completedAt.toISOString() : null
    }))
  };
}
