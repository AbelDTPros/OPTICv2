import type { QueryExecutor } from '../../../platform/db/types.js';
import type { QueueProjectionRecord, QueueQuery, QueueQueryResult } from '../domain/types.js';
import type { ProjectionSearchQuery } from '../../search/domain/types.js';

export interface QueueProjectionRepository {
  upsert(record: QueueProjectionRecord, executor?: QueryExecutor): Promise<void>;
  findByInstanceId(workflowInstanceId: number, executor?: QueryExecutor): Promise<QueueProjectionRecord | null>;
  findByEntity(
    entityType: string,
    entityTrackingId: string,
    executor?: QueryExecutor
  ): Promise<QueueProjectionRecord | null>;
  query(query: QueueQuery, executor?: QueryExecutor): Promise<QueueQueryResult>;
  search(query: ProjectionSearchQuery, executor?: QueryExecutor): Promise<QueueQueryResult>;
  /** Drops Live queue cards for every instance pinned to the release (publish/activate scrub). */
  deleteByReleaseId(definitionReleaseId: number, executor?: QueryExecutor): Promise<number>;
}
