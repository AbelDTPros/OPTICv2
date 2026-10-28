import { notFound, validationFailed } from '../../../platform/errors/app-error.js';
import type { ActorContext } from '../../../platform/security/actor.js';
import type { AuthorizationPort } from '../../../platform/security/authorization-port.js';
import { assignmentPermissions } from '../../configuration/domain/assignment-policy.js';
import type { SlaDefinition, StageDefinition } from '../../configuration/domain/types.js';
import type { DefinitionLoader } from '../../configuration/definitions/definition-loader.js';
import type { DefinitionRepository } from '../../configuration/persistence/definition.repository.js';
import { assembleDefinitionRelease } from '../../configuration/service/assemble-release.js';
import type { WorkflowInstanceService } from '../../workflow/service/workflow-instance.service.js';
import { matchesEligibility, parseQueueEligibility } from '../domain/eligibility.js';
import { actionLabel, ALLOWED_PAGE_SIZES, isAllowedPageSize, queueFieldByKey } from '../domain/fields.js';
import {
  SYSTEM_QUEUE_ASSIGNED_TO_ME,
  compareOfficerQueueKeys,
  isSystemOfficerQueue,
  orderedOfficerQueueKeys,
  systemOfficerQueues
} from '../domain/officer-queues.js';
import { formatAgeInQueue } from '../domain/project.js';
import { computeSlaState } from '../domain/sla-state.js';
import type {
  CatalogedQueue,
  QueueBulkActionView,
  QueuePageView,
  QueueProjectionRecord,
  QueueQuerySort,
  QueueRowView
} from '../domain/types.js';
import type { QueueProjectionRepository } from '../persistence/queue-projection.repository.js';

export interface ListQueueQuery {
  page?: number;
  pageSize?: number;
  sort?: string;
  direction?: 'ASC' | 'DESC';
  definitionKey?: string;
  filters?: Record<string, string>;
}

export interface QueueAssignCommand {
  queueKey: string;
  definitionKey?: string;
  entityType: string;
  trackingId: string;
  expectedRowVersion: number;
}

export type QueueReleaseCommand = QueueAssignCommand;

export interface QueueReassignCommand extends QueueAssignCommand {
  assignedTo: string;
}

export class QueueService {
  constructor(
    private readonly definitions: DefinitionRepository,
    private readonly loader: DefinitionLoader,
    private readonly projections: QueueProjectionRepository,
    private readonly workflow: WorkflowInstanceService,
    private readonly authorization: AuthorizationPort
  ) {}

  async listQueues(actor: ActorContext): Promise<CatalogedQueue[]> {
    await this.authorization.assertCanReadQueue(actor);
    const catalog = await this.catalog();
    const visible: CatalogedQueue[] = [];
    for (const item of catalog.values()) {
      if (await this.authorization.canAccessQueue(actor, item.queueKey)) {
        visible.push(item);
      }
    }
    const listed = await Promise.all(
      visible.map(async (item) => ({
        ...item,
        total: await this.countQueue(actor, item)
      }))
    );
    return listed.sort((left, right) => {
      const definition = left.definitionKey.localeCompare(right.definitionKey);
      if (definition !== 0) {
        return definition;
      }
      const byStage = left.officerSortIndex - right.officerSortIndex;
      return byStage !== 0 ? byStage : compareOfficerQueueKeys(left.queueKey, right.queueKey);
    });
  }

  async getQueuePage(actor: ActorContext, queueKey: string, query: ListQueueQuery): Promise<QueuePageView> {
    await this.authorization.assertCanReadQueue(actor);
    const cataloged = await this.requireQueue(queueKey, query.definitionKey);
    if (!(await this.authorization.canAccessQueue(actor, queueKey))) {
      throw notFound('OPTIC-WF-40420', `Queue ${queueKey} was not found.`);
    }
    const eligibility = parseQueueEligibility(cataloged.queue.eligibility, queueKey);
    const allowedFilters = new Set(cataloged.queue.filters);
    const appliedFilters: Record<string, string> = {};
    const requestedFilters = {
      ...query.filters,
      ...(queueKey === SYSTEM_QUEUE_ASSIGNED_TO_ME ? { assignedStatus: 'MINE' } : {})
    };
    for (const [key, value] of Object.entries(requestedFilters)) {
      if (!value) {
        continue;
      }
      if (!allowedFilters.has(key)) {
        throw validationFailed('OPTIC-WF-40060', `Filter ${key} is not configured on queue ${queueKey}.`, [
          { field: key, path: 'filters', message: `${key} is not a configured filter.` }
        ]);
      }
      appliedFilters[key] = value;
    }

    const pageSize = resolvePageSize(query.pageSize, cataloged.queue.pageSize);
    const page = query.page && query.page > 0 ? query.page : 1;
    const sort = resolveSort(query.sort, query.direction, cataloged.queue.defaultSort);

    const result = await this.projections.query({
      eligibility,
      entityType: cataloged.queue.entityType,
      definitionKey: cataloged.definitionKey,
      filters: appliedFilters,
      sort,
      page,
      pageSize,
      actorId: actor.actorId
    });

    const pinnedByRelease = await this.rowContextForRows(queueKey, cataloged.queue.columns, result.rows);
    const pageColumns = uniqueColumns(
      cataloged.queue.columns,
      ...[...pinnedByRelease.values()].map((item) => item.columns)
    );

    return {
      queueKey: cataloged.queueKey,
      displayName: cataloged.displayName,
      entityType: cataloged.entityType,
      definitionKey: cataloged.definitionKey,
      version: cataloged.version,
      columns: pageColumns.map((key) => {
        const spec = queueFieldByKey(key);
        return {
          key,
          label:
            spec?.label ??
            cataloged.queue.projectedFields?.find((field) => field.fieldKey === key)?.label ??
            key,
          sortable: spec?.sortable ?? false
        };
      }),
      filters: cataloged.queue.filters.map((key) => ({
        key,
        label: queueFieldByKey(key)?.label ?? key
      })),
      actions: cataloged.queue.actions.map((actionKey) => ({
        actionKey,
        label: actionLabel(actionKey)
      })),
      bulkActions: await this.bulkActionsForQueue(
        actor,
        queueKey,
        [Number(cataloged.releaseId), ...result.rows.map((row) => row.definitionReleaseId)]
      ),
      page,
      pageSize,
      total: result.total,
      sort,
      appliedFilters,
      rows: await Promise.all(
        result.rows.map(async (row) => {
          const pinned = pinnedByRelease.get(row.definitionReleaseId);
          const liveRow = withFreshSlaState(row, pinned);
          if (liveRow.slaState !== row.slaState) {
            try {
              await this.projections.upsert({ ...liveRow, updatedAt: new Date() });
            } catch {
              // Read path still returns fresh state even if persistence fails.
            }
          }
          return toRowView(liveRow, pageColumns, pinned);
        })
      )
    };
  }

  async assignFromQueue(actor: ActorContext, command: QueueAssignCommand) {
    await this.authorization.assertCanAssignFromQueue(actor, command.queueKey);
    await this.requireEligibleRow(actor, command);
    return this.workflow.assignToSelf(actor, {
      entityType: command.entityType,
      entityTrackingId: command.trackingId,
      expectedRowVersion: command.expectedRowVersion
    });
  }

  async releaseFromQueue(actor: ActorContext, command: QueueReleaseCommand) {
    await this.authorization.assertCanReleaseFromQueue(actor, command.queueKey);
    await this.requireEligibleRow(actor, command);
    return this.workflow.releaseAssignment(actor, {
      entityType: command.entityType,
      entityTrackingId: command.trackingId,
      expectedRowVersion: command.expectedRowVersion
    });
  }

  async reassignFromQueue(actor: ActorContext, command: QueueReassignCommand) {
    await this.authorization.assertCanReassignWorkflow(actor);
    await this.requireEligibleRow(actor, command);
    return this.workflow.reassign(actor, {
      entityType: command.entityType,
      entityTrackingId: command.trackingId,
      expectedRowVersion: command.expectedRowVersion,
      assignedTo: command.assignedTo
    });
  }

  async rebuildProjections(): Promise<number> {
    return this.workflow.rebuildProjections();
  }

  private async requireEligibleRow(actor: ActorContext, command: QueueAssignCommand) {
    const cataloged = await this.requireQueue(command.queueKey, command.definitionKey);
    if (!(await this.authorization.canAccessQueue(actor, command.queueKey))) {
      throw notFound('OPTIC-WF-40420', `Queue ${command.queueKey} was not found.`);
    }
    const eligibility = parseQueueEligibility(cataloged.queue.eligibility, command.queueKey);
    const row = await this.projections.findByEntity(command.entityType, command.trackingId);
    if (
      !row ||
      row.entityType !== cataloged.queue.entityType ||
      row.definitionKey !== cataloged.definitionKey ||
      !matchesEligibility(row, eligibility)
    ) {
      throw validationFailed(
        'OPTIC-WF-40061',
        `${command.trackingId} is not eligible for queue ${command.queueKey}.`
      );
    }
    return row;
  }

  private async rowContextForRows(
    queueKey: string,
    fallback: string[],
    rows: QueueProjectionRecord[]
  ): Promise<Map<number, RowReleaseContext>> {
    const pinned = new Map<number, RowReleaseContext>();
    const releaseIds = [...new Set(rows.map((row) => row.definitionReleaseId))];
    for (const releaseId of releaseIds) {
      const compiled = await this.loader.loadByReleaseId(releaseId);
      const columns = compiled.release.queues[queueKey]?.columns;
      pinned.set(releaseId, {
        columns: columns && columns.length > 0 ? columns : fallback,
        version: compiled.version,
        releaseId: compiled.releaseId,
        stages: compiled.release.workflow.stages,
        slas: compiled.release.slas ?? {}
      });
    }
    return pinned;
  }

  private async bulkActionsForQueue(
    actor: ActorContext,
    queueKey: string,
    releaseIds: number[]
  ): Promise<QueueBulkActionView[]> {
    const seen = new Set<string>();
    const actions: QueueBulkActionView[] = [];
    for (const releaseId of [...new Set(releaseIds.filter((id) => Number.isFinite(id) && id > 0))]) {
      const compiled = await this.loader.loadByReleaseId(releaseId);
      const stageKeys = new Set(
        compiled.release.workflow.stages
          .filter((stage) => stage.queueKey === queueKey)
          .map((stage) => stage.stageKey)
      );
      for (const bulk of Object.values(compiled.release.bulkActions)) {
        const listed = compiled.release.workflow.stages.some((stage) =>
          (stage.bulkActionKeys ?? []).includes(bulk.bulkActionKey) && stage.queueKey === queueKey
        );
        if (!listed && !stageKeys.has(bulk.stageKey)) {
          continue;
        }
        if (seen.has(bulk.bulkActionKey)) {
          continue;
        }
        if (!(await this.authorization.canExecuteBulkAction(actor, bulk.bulkActionKey))) {
          continue;
        }
        seen.add(bulk.bulkActionKey);
        actions.push({
          bulkActionKey: bulk.bulkActionKey,
          label: bulk.label,
          stageKey: bulk.stageKey,
          maxSelection: bulk.maxSelection,
          transactionMode: bulk.transactionMode,
          sharedInputSchema: bulk.sharedInputSchema
        });
      }
    }
    return actions;
  }

  private async countQueue(actor: ActorContext, cataloged: CatalogedQueue): Promise<number> {
    const eligibility = parseQueueEligibility(cataloged.queue.eligibility, cataloged.queueKey);
    const result = await this.projections.query({
      eligibility,
      entityType: cataloged.queue.entityType,
      definitionKey: cataloged.definitionKey,
      filters: cataloged.queueKey === SYSTEM_QUEUE_ASSIGNED_TO_ME ? { assignedStatus: 'MINE' } : {},
      sort: cataloged.queue.defaultSort.length > 0 ? cataloged.queue.defaultSort : [{ field: 'enteredStageAt', direction: 'ASC' }],
      page: 1,
      pageSize: 1,
      actorId: actor.actorId
    });
    return result.total;
  }

  private async requireQueue(queueKey: string, definitionKey?: string): Promise<CatalogedQueue> {
    const catalog = await this.catalog();
    if (definitionKey) {
      const found = catalog.get(catalogKey(definitionKey, queueKey));
      if (!found) {
        throw notFound('OPTIC-WF-40420', `Queue ${queueKey} was not found.`);
      }
      return found;
    }
    const matches = [...catalog.values()].filter((item) => item.queueKey === queueKey);
    if (matches.length === 1 && matches[0]) {
      return matches[0];
    }
    if (matches.length === 0) {
      throw notFound('OPTIC-WF-40420', `Queue ${queueKey} was not found.`);
    }
    throw validationFailed(
      'OPTIC-WF-40060',
      `Queue ${queueKey} is used by more than one definition. Pass definitionKey.`,
      [{ field: 'definitionKey', path: 'definitionKey', message: 'definitionKey is required when queue keys collide.' }]
    );
  }

  private async catalog(): Promise<Map<string, CatalogedQueue>> {
    const definitions = await this.definitions.listDefinitions();
    const catalog = new Map<string, CatalogedQueue>();
    for (const definition of definitions) {
      if (!definition.activeReleaseId) {
        continue;
      }
      const record = await this.definitions.findReleaseById(definition.activeReleaseId);
      if (!record || record.lifecycleStatus !== 'PUBLISHED') {
        continue;
      }
      const assembled = await assembleDefinitionRelease(this.definitions, record);
      this.loader.compile(assembled);
      const officerOrder = orderedOfficerQueueKeys(
        assembled.workflow,
        assembled.queues,
        assembled.entityType
      );
      const officerSortIndex = new Map(officerOrder.map((queueKey, index) => [queueKey, index]));
      for (const queue of Object.values(assembled.queues)) {
        if (isSystemOfficerQueue(queue.queueKey)) {
          continue;
        }
        catalog.set(catalogKey(assembled.definitionKey, queue.queueKey), {
          queueKey: queue.queueKey,
          displayName: queue.displayName,
          entityType: queue.entityType,
          definitionKey: assembled.definitionKey,
          version: assembled.version,
          releaseId: assembled.id,
          queue,
          officerSortIndex: officerSortIndex.get(queue.queueKey) ?? Number.MAX_SAFE_INTEGER
        });
      }
      for (const queue of systemOfficerQueues(assembled.entityType)) {
        catalog.set(catalogKey(assembled.definitionKey, queue.queueKey), {
          queueKey: queue.queueKey,
          displayName: queue.displayName,
          entityType: queue.entityType,
          definitionKey: assembled.definitionKey,
          version: assembled.version,
          releaseId: assembled.id,
          queue,
          officerSortIndex: officerSortIndex.get(queue.queueKey) ?? Number.MAX_SAFE_INTEGER
        });
      }
    }
    return catalog;
  }
}

function catalogKey(definitionKey: string, queueKey: string): string {
  return `${definitionKey}\0${queueKey}`;
}

function resolvePageSize(requested: number | undefined, configured: number): number {
  const fallback = isAllowedPageSize(configured) ? configured : 25;
  if (requested === undefined) {
    return fallback;
  }
  if (!isAllowedPageSize(requested)) {
    throw validationFailed(
      'OPTIC-WF-40060',
      `pageSize must be one of ${ALLOWED_PAGE_SIZES.join(', ')}.`,
      [{ field: 'pageSize', path: 'pageSize', message: 'Use 10, 25, 50, or 100.' }]
    );
  }
  return requested;
}

function resolveSort(
  field: string | undefined,
  direction: 'ASC' | 'DESC' | undefined,
  defaults: QueueQuerySort[]
): QueueQuerySort[] {
  if (!field) {
    return defaults.length > 0 ? defaults : [{ field: 'enteredStageAt', direction: 'ASC' }];
  }
  const spec = queueFieldByKey(field);
  if (!spec?.sortable) {
    throw validationFailed('OPTIC-WF-40060', `Sort field ${field} is not allowed.`, [
      { field: 'sort', path: 'sort', message: `${field} is not a sortable queue field.` }
    ]);
  }
  return [{ field, direction: direction ?? 'ASC' }];
}

interface RowReleaseContext {
  columns: string[];
  version: string;
  releaseId: string;
  stages: StageDefinition[];
  slas: Record<string, SlaDefinition>;
}

function toRowView(
  row: QueueProjectionRecord,
  pageColumns: string[],
  pinned?: RowReleaseContext
): QueueRowView {
  const pinnedColumns = pinned?.columns ?? pageColumns;
  const values: Record<string, string | number | null> = {};
  for (const column of pageColumns) {
    values[column] = pinnedColumns.includes(column) ? columnValue(row, column) : null;
  }
  const stage = pinned?.stages.find((item) => item.stageKey === row.currentStageKey);
  const permissions = assignmentPermissions(stage, row.status);
  return {
    workflowInstanceId: row.workflowInstanceId,
    entityType: row.entityType,
    trackingId: row.entityTrackingId,
    definitionKey: row.definitionKey,
    definitionVersion: pinned?.version ?? '',
    releaseId: pinned?.releaseId ?? String(row.definitionReleaseId),
    currentStageKey: row.currentStageKey,
    status: row.status,
    allowAssign: permissions.allowAssign,
    allowReassign: permissions.allowReassign,
    allowRelease: permissions.allowRelease,
    assignedTo: row.assignedTo,
    assignedStatus: row.assignedTo ? 'ASSIGNED' : 'UNASSIGNED',
    enteredStageAt: row.enteredStageAt.toISOString(),
    rowVersion: row.rowVersion,
    pinnedColumns,
    values
  };
}

function withFreshSlaState(
  row: QueueProjectionRecord,
  pinned?: RowReleaseContext
): QueueProjectionRecord {
  if (!pinned) {
    return row;
  }
  const stage = pinned.stages.find((item) => item.stageKey === row.currentStageKey);
  const slaKey = stage?.slaKey?.trim();
  const sla = slaKey ? pinned.slas[slaKey] : undefined;
  const slaState = computeSlaState({
    sla,
    enteredStageAt: row.enteredStageAt,
    currentStageKey: row.currentStageKey
  });
  if (slaState === row.slaState) {
    return row;
  }
  return { ...row, slaState };
}

function uniqueColumns(...groups: string[][]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const group of groups) {
    for (const column of group) {
      if (!seen.has(column)) {
        seen.add(column);
        ordered.push(column);
      }
    }
  }
  return ordered;
}

function columnValue(row: QueueProjectionRecord, column: string): string | number | null {
  switch (column) {
    case 'trackingId':
      return row.entityTrackingId;
    case 'entityType':
      return row.entityType;
    case 'definitionKey':
      return row.definitionKey;
    case 'currentStageKey':
      return row.currentStageKey;
    case 'assignedTo':
      return row.assignedTo;
    case 'assignedStatus':
      return row.assignedTo ? 'Assigned' : 'Unassigned';
    case 'enteredStageAt':
      return row.enteredStageAt.toISOString();
    case 'ageInQueue':
      return formatAgeInQueue(row.enteredStageAt);
    case 'workloadType':
      return row.workloadType;
    case 'receiptNumber':
      return row.receiptNumber;
    case 'receivedDate':
      return row.receivedAt ? row.receivedAt.toISOString().slice(0, 10) : null;
    case 'slaState':
      return row.slaState;
    case 'branch':
      return row.branchKey;
    case 'location':
      return row.locationKey;
    case 'priority':
      return row.priority;
    case 'status':
      return row.status;
    default: {
      const extra = row.projectedJson?.[column];
      if (typeof extra === 'string' || typeof extra === 'number') {
        return extra;
      }
      return null;
    }
  }
}
