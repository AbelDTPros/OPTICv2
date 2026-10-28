import type {
  DefinitionRelease,
  SearchFieldDefinition,
  SlaDefinition
} from '../../configuration/domain/types.js';
import { fieldUsedInDashboard } from '../../configuration/domain/indexed-fields.js';
import {
  computeSlaState,
  isBreachedSlaState
} from '../../queue/domain/sla-state.js';
import type { DefinitionLoader } from '../../configuration/definitions/definition-loader.js';
import type { DefinitionRepository } from '../../configuration/persistence/definition.repository.js';
import type { QueueProjectionRecord } from '../../queue/domain/types.js';
import type { QueueProjectionRepository } from '../../queue/persistence/queue-projection.repository.js';
import { matchDimensionValue } from '../../search/domain/match.js';
import type { AuditEventRecord, AuditEventRepository } from '../../../platform/audit/audit-event.repository.js';
import { validationFailed } from '../../../platform/errors/app-error.js';
import type { ActorContext } from '../../../platform/security/actor.js';
import type { AuthorizationPort } from '../../../platform/security/authorization-port.js';

const ACTIVITY_TYPES = [
  'STAGE_TRANSITIONED',
  'WORKLOAD_ASSIGNED',
  'WORKLOAD_REASSIGNED',
  'WORKLOAD_RELEASED',
  'WORKLOAD_CREATED',
  'MAIL_CREATED'
] as const;

export interface SupervisorDashboardQuery {
  definitionKeys: string[];
  activityLimit?: number;
  /** fieldKey → needle for Catalog indexed fields with useInDashboard. */
  filters?: Record<string, string>;
}

export interface SupervisorDashboardDimension {
  fieldKey: string;
  label: string;
  match: string;
}

export interface SupervisorDashboardView {
  definitionKeys: string[];
  asOf: string;
  dimensions: SupervisorDashboardDimension[];
  appliedFilters: Record<string, string>;
  kpis: {
    loggedToday: number;
    openBacklog: number;
    pastSla: number;
  };
  stages: Array<{
    stageKey: string;
    displayName: string;
    count: number;
    oldestEnteredStageAt: string | null;
    oldestAgeMinutes: number | null;
    lateCount: number;
  }>;
  pressure: Array<{
    stageKey: string;
    displayName: string;
    lateCount: number;
    oldestAgeMinutes: number | null;
    count: number;
  }>;
  /** Open work grouped by assignee — for clearing unassigned / balancing load. */
  assignees: Array<{
    assignedTo: string | null;
    label: string;
    count: number;
    lateCount: number;
    oldestAgeMinutes: number | null;
    /** Open cases for this assignee (late first, capped). */
    cases: Array<{
      trackingId: string;
      entityType: string;
      definitionKey: string;
      stageKey: string;
      stageDisplayName: string;
      assignedTo: string | null;
      ageMinutes: number;
      pastSla: boolean;
    }>;
  }>;
  /** Oldest / past-SLA cases to open directly (capped). */
  actionQueue: Array<{
    trackingId: string;
    entityType: string;
    definitionKey: string;
    stageKey: string;
    stageDisplayName: string;
    assignedTo: string | null;
    ageMinutes: number;
    pastSla: boolean;
  }>;
  recentActivity: Array<{
    eventId: string;
    eventType: string;
    occurredAt: string;
    actorId: string | null;
    actorName: string | null;
    entityType: string | null;
    entityTrackingId: string | null;
    definitionKey: string | null;
    stageKey: string | null;
    summary: string;
  }>;
}

export class SupervisorDashboardService {
  constructor(
    private readonly projections: QueueProjectionRepository,
    private readonly audit: AuditEventRepository,
    private readonly definitions: DefinitionRepository,
    private readonly loader: DefinitionLoader,
    private readonly authorization: AuthorizationPort
  ) {}

  async getDashboard(
    actor: ActorContext,
    query: SupervisorDashboardQuery
  ): Promise<SupervisorDashboardView> {
    await this.authorization.assertCanReadSupervisorDashboard(actor);
    const definitionKeys = [...new Set(query.definitionKeys.map((key) => key.trim()).filter(Boolean))];
    if (definitionKeys.length === 0) {
      throw validationFailed('OPTIC-SUP-40001', 'At least one definitionKey is required.', [
        { field: 'definitionKey', path: 'definitionKey', message: 'Required.' }
      ]);
    }

    const now = new Date();
    const { byDefinitionStage, stages: stageCatalog, dashboardFieldsByDefinition, dimensions } =
      await this.loadStageMeta(definitionKeys);
    const appliedFilters = normalizeFilters(query.filters, dimensions);
    const allRows = await this.projections.listByDefinitionKeys(definitionKeys);
    const rows = allRows.filter((row) =>
      rowMatchesDashboardFilters(row, appliedFilters, dashboardFieldsByDefinition)
    );
    const active = rows.filter((row) => row.status === 'ACTIVE');
    const dayStart = startOfUtcDay(now);

    const stageBuckets = new Map<
      string,
      { count: number; oldest: Date | null; lateCount: number }
    >();
    for (const meta of stageCatalog) {
      stageBuckets.set(meta.stageKey, { count: 0, oldest: null, lateCount: 0 });
    }
    for (const row of active) {
      const bucket = stageBuckets.get(row.currentStageKey) ?? {
        count: 0,
        oldest: null,
        lateCount: 0
      };
      bucket.count += 1;
      if (!bucket.oldest || row.enteredStageAt.getTime() < bucket.oldest.getTime()) {
        bucket.oldest = row.enteredStageAt;
      }
      if (isPastSla(row, byDefinitionStage.get(`${row.definitionKey}:${row.currentStageKey}`), now)) {
        bucket.lateCount += 1;
      }
      stageBuckets.set(row.currentStageKey, bucket);
    }

    const stageViews = [...stageBuckets.entries()]
      .map(([stageKey, bucket]) => {
        const catalog = stageCatalog.find((meta) => meta.stageKey === stageKey);
        const oldestAgeMinutes =
          bucket.oldest != null
            ? Math.max(0, Math.floor((now.getTime() - bucket.oldest.getTime()) / 60_000))
            : null;
        return {
          stageKey,
          displayName: catalog?.displayName ?? stageKey,
          count: bucket.count,
          oldestEnteredStageAt: bucket.oldest?.toISOString() ?? null,
          oldestAgeMinutes,
          lateCount: bucket.lateCount,
          order: catalog?.order ?? 9999
        };
      })
      .filter((stage) => stage.count > 0 || stage.order < 9000)
      .sort((left, right) => left.order - right.order || left.displayName.localeCompare(right.displayName))
      .map(({ order: _order, ...stage }) => stage);
    const pastSla = stageViews.reduce((sum, stage) => sum + stage.lateCount, 0);
    const pressure = [...stageViews]
      .filter((stage) => stage.count > 0)
      .sort(
        (left, right) =>
          right.lateCount - left.lateCount ||
          (right.oldestAgeMinutes ?? 0) - (left.oldestAgeMinutes ?? 0) ||
          right.count - left.count
      )
      .map((stage) => ({
        stageKey: stage.stageKey,
        displayName: stage.displayName,
        lateCount: stage.lateCount,
        oldestAgeMinutes: stage.oldestAgeMinutes,
        count: stage.count
      }));

    const stageDisplay = new Map(stageViews.map((stage) => [stage.stageKey, stage.displayName]));
    type ActionCandidate = {
      row: QueueProjectionRecord;
      pastSla: boolean;
      ageMinutes: number;
    };
    const assigneeBuckets = new Map<
      string,
      {
        assignedTo: string | null;
        count: number;
        lateCount: number;
        oldest: Date | null;
        cases: ActionCandidate[];
      }
    >();
    const actionCandidates: ActionCandidate[] = [];

    for (const row of active) {
      const late = isPastSla(row, byDefinitionStage.get(`${row.definitionKey}:${row.currentStageKey}`), now);
      const ageMinutes = Math.max(
        0,
        Math.floor((now.getTime() - row.enteredStageAt.getTime()) / 60_000)
      );
      const key = row.assignedTo?.trim() ? row.assignedTo.trim() : '';
      const bucket = assigneeBuckets.get(key) ?? {
        assignedTo: key ? key : null,
        count: 0,
        lateCount: 0,
        oldest: null,
        cases: []
      };
      bucket.count += 1;
      if (late) {
        bucket.lateCount += 1;
      }
      if (!bucket.oldest || row.enteredStageAt.getTime() < bucket.oldest.getTime()) {
        bucket.oldest = row.enteredStageAt;
      }
      bucket.cases.push({ row, pastSla: late, ageMinutes });
      assigneeBuckets.set(key, bucket);
      if (late || !key) {
        actionCandidates.push({ row, pastSla: late, ageMinutes });
      }
    }

    const serializeAction = ({
      row,
      pastSla: rowPastSla,
      ageMinutes
    }: ActionCandidate): SupervisorDashboardView['actionQueue'][number] => ({
      trackingId: row.entityTrackingId,
      entityType: row.entityType,
      definitionKey: row.definitionKey,
      stageKey: row.currentStageKey,
      stageDisplayName: stageDisplay.get(row.currentStageKey) ?? row.currentStageKey,
      assignedTo: row.assignedTo,
      ageMinutes,
      pastSla: rowPastSla
    });

    const sortActionCandidates = (left: ActionCandidate, right: ActionCandidate) =>
      Number(right.pastSla) - Number(left.pastSla) ||
      right.ageMinutes - left.ageMinutes ||
      left.row.entityTrackingId.localeCompare(right.row.entityTrackingId);

    const assignees = [...assigneeBuckets.values()]
      .map((bucket) => ({
        assignedTo: bucket.assignedTo,
        label: bucket.assignedTo ?? 'Unassigned',
        count: bucket.count,
        lateCount: bucket.lateCount,
        oldestAgeMinutes:
          bucket.oldest != null
            ? Math.max(0, Math.floor((now.getTime() - bucket.oldest.getTime()) / 60_000))
            : null,
        cases: [...bucket.cases].sort(sortActionCandidates).slice(0, 100).map(serializeAction)
      }))
      .sort((left, right) => {
        const leftUnassigned = left.assignedTo == null ? 0 : 1;
        const rightUnassigned = right.assignedTo == null ? 0 : 1;
        return (
          leftUnassigned - rightUnassigned ||
          right.lateCount - left.lateCount ||
          right.count - left.count ||
          left.label.localeCompare(right.label)
        );
      });

    const actionQueue = actionCandidates
      .sort(sortActionCandidates)
      .slice(0, 100)
      .map(serializeAction);

    const activityLimit = Math.max(1, Math.min(50, Math.trunc(query.activityLimit ?? 50)));
    const events = await this.audit.listRecentForDefinitions(
      definitionKeys,
      [...ACTIVITY_TYPES],
      activityLimit
    );

    return {
      definitionKeys,
      asOf: now.toISOString(),
      dimensions,
      appliedFilters,
      kpis: {
        loggedToday: rows.filter(
          (row) => row.receivedAt != null && row.receivedAt.getTime() >= dayStart.getTime()
        ).length,
        openBacklog: active.length,
        pastSla
      },
      stages: stageViews,
      pressure,
      assignees,
      actionQueue,
      recentActivity: events.map((event) => serializeActivity(event))
    };
  }

  private async loadStageMeta(definitionKeys: string[]): Promise<{
    byDefinitionStage: Map<string, SlaDefinition | undefined>;
    stages: Array<{ stageKey: string; displayName: string; order: number }>;
    dashboardFieldsByDefinition: Map<string, SearchFieldDefinition[]>;
    dimensions: SupervisorDashboardDimension[];
  }> {
    const byDefinitionStage = new Map<string, SlaDefinition | undefined>();
    const stagesByKey = new Map<string, { stageKey: string; displayName: string; order: number }>();
    const dashboardFieldsByDefinition = new Map<string, SearchFieldDefinition[]>();
    const dimensionsByKey = new Map<string, SupervisorDashboardDimension>();
    for (const definitionKey of definitionKeys) {
      const definition = await this.definitions.findDefinitionByKey(definitionKey);
      if (definition?.activeReleaseId == null) {
        continue;
      }
      let release: DefinitionRelease;
      try {
        const compiled = await this.loader.loadByReleaseId(definition.activeReleaseId);
        release = compiled.release;
      } catch {
        continue;
      }
      const dashboardFields = (release.search?.fields ?? []).filter(
        (field) => field.source === 'BUSINESS_DATA' && fieldUsedInDashboard(field)
      );
      dashboardFieldsByDefinition.set(definitionKey, dashboardFields);
      for (const field of dashboardFields) {
        if (!dimensionsByKey.has(field.fieldKey)) {
          dimensionsByKey.set(field.fieldKey, {
            fieldKey: field.fieldKey,
            label: humanizeFieldKey(field.fieldKey),
            match: field.match
          });
        }
      }
      const ordered = [...(release.workflow?.stages ?? [])].sort(
        (left, right) => (left.order ?? 0) - (right.order ?? 0)
      );
      for (const [index, stage] of ordered.entries()) {
        const sla = stage.slaKey ? release.slas?.[stage.slaKey] : undefined;
        byDefinitionStage.set(`${definitionKey}:${stage.stageKey}`, sla);
        const existing = stagesByKey.get(stage.stageKey);
        const order = stage.order ?? index;
        if (!existing || order < existing.order) {
          stagesByKey.set(stage.stageKey, {
            stageKey: stage.stageKey,
            displayName: stage.displayName || stage.stageKey,
            order
          });
        }
      }
    }
    return {
      byDefinitionStage,
      stages: [...stagesByKey.values()].sort((left, right) => left.order - right.order),
      dashboardFieldsByDefinition,
      dimensions: [...dimensionsByKey.values()].sort((left, right) =>
        left.label.localeCompare(right.label)
      )
    };
  }
}

function normalizeFilters(
  filters: Record<string, string> | undefined,
  dimensions: SupervisorDashboardDimension[]
): Record<string, string> {
  if (!filters) {
    return {};
  }
  const allowed = new Set(dimensions.map((item) => item.fieldKey));
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    const trimmed = value.trim();
    if (!allowed.has(key) || !trimmed) {
      continue;
    }
    next[key] = trimmed;
  }
  return next;
}

function rowMatchesDashboardFilters(
  row: QueueProjectionRecord,
  filters: Record<string, string>,
  fieldsByDefinition: Map<string, SearchFieldDefinition[]>
): boolean {
  const entries = Object.entries(filters);
  if (entries.length === 0) {
    return true;
  }
  const fields = fieldsByDefinition.get(row.definitionKey) ?? [];
  for (const [fieldKey, needle] of entries) {
    const field = fields.find((item) => item.fieldKey === fieldKey);
    if (!field) {
      // Dimension not authored on this definition — do not exclude the row.
      continue;
    }
    if (!matchDimensionValue(row, field, needle)) {
      return false;
    }
  }
  return true;
}

function humanizeFieldKey(fieldKey: string): string {
  return fieldKey
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function isPastSla(
  row: QueueProjectionRecord,
  sla: SlaDefinition | undefined,
  now: Date
): boolean {
  if (isBreachedSlaState(row.slaState)) {
    return true;
  }
  return (
    computeSlaState({
      sla,
      enteredStageAt: row.enteredStageAt,
      currentStageKey: row.currentStageKey,
      now
    }) === 'BREACHED'
  );
}

function serializeActivity(event: AuditEventRecord) {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    occurredAt: event.occurredAt.toISOString(),
    actorId: event.actorId,
    actorName: event.actorName,
    entityType: event.entityType,
    entityTrackingId: event.entityTrackingId,
    definitionKey: event.definitionKey,
    stageKey: event.stageKey,
    summary: activitySummary(event)
  };
}

function activitySummary(event: AuditEventRecord): string {
  const who = event.actorName || event.actorId || 'Someone';
  // Tracking id is rendered as an open/copy control under the summary — keep prose generic.
  switch (event.eventType) {
    case 'STAGE_TRANSITIONED':
      return `${who} moved a case${event.stageKey ? ` to ${event.stageKey}` : ''}.`;
    case 'WORKLOAD_ASSIGNED':
      return `${who} claimed a case.`;
    case 'WORKLOAD_REASSIGNED':
      return `${who} reassigned a case.`;
    case 'WORKLOAD_RELEASED':
      return `${who} released a case.`;
    case 'WORKLOAD_CREATED':
    case 'MAIL_CREATED':
      return `${who} logged a case.`;
    default:
      return `${who}: ${event.eventType.replace(/_/g, ' ').toLowerCase()} on a case.`;
  }
}
