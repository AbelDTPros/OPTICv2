import { validationFailed } from '../../../platform/errors/app-error.js';
import type { ActorContext } from '../../../platform/security/actor.js';
import type { AuthorizationPort } from '../../../platform/security/authorization-port.js';
import type { DefinitionLoader } from '../../configuration/definitions/definition-loader.js';
import { parseScanPayload } from '../../tracking/domain/scan-payload.js';
import { projectInstance } from '../../queue/domain/project.js';
import type { QueueProjectionRecord } from '../../queue/domain/types.js';
import type { QueueProjectionRepository } from '../../queue/persistence/queue-projection.repository.js';
import type { WorkflowInstanceRepository } from '../../workflow/persistence/workflow-instance.repository.js';
import { matchProjection, searchableFields } from '../domain/match.js';
import type { SearchRequest, SearchResultPage } from '../domain/types.js';

const ALLOWED_PAGE_SIZES = new Set([10, 25, 50, 100]);

export class SearchService {
  constructor(
    private readonly projections: QueueProjectionRepository,
    private readonly loader: DefinitionLoader,
    private readonly authorization: AuthorizationPort,
    private readonly instances?: WorkflowInstanceRepository
  ) {}

  async search(actor: ActorContext, request: SearchRequest): Promise<SearchResultPage> {
    await this.authorization.assertCanReadWorkflow(actor);
    const page = request.page;
    const pageSize = request.pageSize;
    if (!ALLOWED_PAGE_SIZES.has(pageSize)) {
      throw validationFailed('OPTIC-WF-40060', 'Search pageSize must be 10, 25, 50, or 100.', [
        { field: 'pageSize', path: 'pageSize', message: 'Use 10, 25, 50, or 100.' }
      ]);
    }
    const parsed = request.q ? parseScanPayload(request.q) : undefined;
    const trackingId = parsed?.trackingId ?? request.q;
    const receiptNumber = request.receiptNumber;
    const entityType = request.entityType || parsed?.entityType;
    const criteria = Object.fromEntries(
      Object.entries(request.criteria ?? {}).filter(([, value]) => value.trim())
    );
    const candidateLimit = Math.max(page * pageSize, 100);
    const candidates = await this.projections.search({
      q: trackingId,
      receiptNumber,
      entityType,
      definitionKey: request.definitionKey,
      currentStageKey: request.currentStageKey,
      assignedTo: request.assignedTo,
      page: 1,
      pageSize: candidateLimit
    });
    let rows = await this.mergeUnprojectedTrackingMatches(candidates.rows, {
      trackingId,
      entityType,
      definitionKey: request.definitionKey,
      currentStageKey: request.currentStageKey,
      assignedTo: request.assignedTo,
      limit: candidateLimit
    });
    // Catalog extras alone (no tracking id) used to filter only the first projection page,
    // so Try/unprojected cases and older rows never matched. Expand from instances.
    if (Object.keys(criteria).length > 0 && !(trackingId ?? '').trim()) {
      rows = await this.mergeCriteriaInstanceMatches(rows, {
        entityType,
        definitionKey: request.definitionKey,
        currentStageKey: request.currentStageKey,
        assignedTo: request.assignedTo,
        limit: Math.max(candidateLimit, 500)
      });
    }
    const hits = [];
    const hasTextNeedles =
      Boolean((trackingId ?? '').trim()) ||
      Boolean((receiptNumber ?? '').trim()) ||
      Object.keys(criteria).length > 0;
    // Catalog extras often live only in business_data until queues are re-projected.
    const needsBusinessData = Object.keys(criteria).length > 0 && Boolean(this.instances);
    for (const row of rows) {
      const compiled = await this.loader.loadByReleaseId(row.definitionReleaseId);
      const fields = searchableFields(compiled.release.search.fields);
      let businessData: Record<string, unknown> | null | undefined;
      if (needsBusinessData) {
        const instance = await this.instances!.findById(row.workflowInstanceId);
        businessData = instance?.businessData ?? null;
      }
      const matched = matchProjection(
        row,
        fields,
        { trackingId, receiptNumber, extras: criteria },
        businessData
      );
      if (hasTextNeedles && matched.length === 0) {
        continue;
      }
      hits.push({
        trackingId: row.entityTrackingId,
        entityType: row.entityType,
        definitionKey: row.definitionKey,
        version: compiled.version,
        currentStageKey: row.currentStageKey,
        assignedTo: row.assignedTo,
        slaState: row.slaState,
        rowVersion: row.rowVersion,
        matchedFields: matched
      });
    }
    const start = (page - 1) * pageSize;
    return {
      q: request.q ?? '',
      receiptNumber: receiptNumber || undefined,
      page,
      pageSize,
      total: hits.length,
      hits: hits.slice(start, start + pageSize)
    };
  }

  /**
   * Try / draft cases skip live queue projection. Still find them by tracking id
   * (including partial contains) so Workspace Find a case matches the help text.
   */
  private async mergeUnprojectedTrackingMatches(
    projected: QueueProjectionRecord[],
    query: {
      trackingId?: string;
      entityType?: string;
      definitionKey?: string;
      currentStageKey?: string;
      assignedTo?: string;
      limit: number;
    }
  ): Promise<QueueProjectionRecord[]> {
    const needle = query.trackingId?.trim() ?? '';
    if (!needle || !this.instances) {
      return projected;
    }
    const instances = await this.instances.searchByTrackingIdContains(needle, { limit: query.limit });
    return this.mergeProjectedInstances(projected, instances, query);
  }

  /**
   * Find a case catalog extras (Last Name, A-Number, …) without a tracking id.
   * Scan workflow instances so Try/draft and stale projection rows still match via business_data.
   */
  private async mergeCriteriaInstanceMatches(
    projected: QueueProjectionRecord[],
    query: {
      entityType?: string;
      definitionKey?: string;
      currentStageKey?: string;
      assignedTo?: string;
      limit: number;
    }
  ): Promise<QueueProjectionRecord[]> {
    if (!this.instances) {
      return projected;
    }
    const instances = await this.instances.listAll();
    return this.mergeProjectedInstances(projected, instances, query);
  }

  private async mergeProjectedInstances(
    projected: QueueProjectionRecord[],
    instances: Awaited<ReturnType<NonNullable<SearchService['instances']>['listAll']>>,
    query: {
      entityType?: string;
      definitionKey?: string;
      currentStageKey?: string;
      assignedTo?: string;
      limit: number;
    }
  ): Promise<QueueProjectionRecord[]> {
    const seen = new Set(projected.map((row) => `${row.entityType}:${row.entityTrackingId}`));
    const extras: QueueProjectionRecord[] = [];
    for (const instance of instances) {
      if (extras.length + projected.length >= query.limit) {
        break;
      }
      const key = `${instance.entityType}:${instance.entityTrackingId}`;
      if (seen.has(key)) {
        continue;
      }
      if (query.entityType && instance.entityType !== query.entityType) {
        continue;
      }
      if (query.currentStageKey && instance.currentStageKey !== query.currentStageKey) {
        continue;
      }
      if (query.assignedTo && instance.assignedTo !== query.assignedTo) {
        continue;
      }
      const compiled = await this.loader.loadByReleaseId(instance.definitionReleaseId);
      if (query.definitionKey && compiled.definitionKey !== query.definitionKey) {
        continue;
      }
      seen.add(key);
      extras.push(projectInstance(instance, compiled));
    }
    if (extras.length === 0) {
      return projected;
    }
    return [...projected, ...extras].slice(0, query.limit);
  }
}
