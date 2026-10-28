import { applyQueueQuery } from '../domain/query.js';
import type { QueueProjectionRecord, QueueQuery, QueueQueryResult } from '../domain/types.js';
import type { ProjectionSearchQuery } from '../../search/domain/types.js';
import type { QueueProjectionRepository } from './queue-projection.repository.js';

export class InMemoryQueueProjectionRepository implements QueueProjectionRepository {
  private readonly rows = new Map<number, QueueProjectionRecord>();

  async upsert(record: QueueProjectionRecord): Promise<void> {
    this.rows.set(record.workflowInstanceId, structuredClone(record));
  }

  async findByInstanceId(workflowInstanceId: number): Promise<QueueProjectionRecord | null> {
    const row = this.rows.get(workflowInstanceId);
    return row ? structuredClone(row) : null;
  }

  async findByEntity(entityType: string, entityTrackingId: string): Promise<QueueProjectionRecord | null> {
    const row = [...this.rows.values()].find(
      (item) => item.entityType === entityType && item.entityTrackingId === entityTrackingId
    );
    return row ? structuredClone(row) : null;
  }

  async query(query: QueueQuery): Promise<QueueQueryResult> {
    return applyQueueQuery([...this.rows.values()].map((row) => structuredClone(row)), query);
  }

  async search(query: ProjectionSearchQuery): Promise<QueueQueryResult> {
    const trackingNeedle = query.q?.trim().toLowerCase() ?? '';
    const receiptNeedle = query.receiptNumber?.trim().toLowerCase() ?? '';
    const rows = [...this.rows.values()]
      .filter((row) => {
        if (query.entityType && row.entityType !== query.entityType) {
          return false;
        }
        if (query.definitionKey && row.definitionKey !== query.definitionKey) {
          return false;
        }
        if (query.currentStageKey && row.currentStageKey !== query.currentStageKey) {
          return false;
        }
        if (query.assignedTo && row.assignedTo !== query.assignedTo) {
          return false;
        }
        if (trackingNeedle && !row.entityTrackingId.toLowerCase().includes(trackingNeedle)) {
          return false;
        }
        if (receiptNeedle && !(row.receiptNumber ?? '').toLowerCase().startsWith(receiptNeedle)) {
          return false;
        }
        return true;
      })
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      .map((row) => structuredClone(row));
    return { rows, total: rows.length };
  }

  async listByDefinitionKeys(definitionKeys: string[]): Promise<QueueProjectionRecord[]> {
    const keys = new Set(definitionKeys);
    if (keys.size === 0) {
      return [];
    }
    return [...this.rows.values()]
      .filter((row) => keys.has(row.definitionKey))
      .map((row) => structuredClone(row));
  }

  async deleteByReleaseId(definitionReleaseId: number): Promise<number> {
    let removed = 0;
    for (const [id, row] of this.rows) {
      if (row.definitionReleaseId === definitionReleaseId) {
        this.rows.delete(id);
        removed += 1;
      }
    }
    return removed;
  }
}
