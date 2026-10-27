import type { QueryExecutor } from '../../../platform/db/types.js';
import type { TrackingIdRecord } from '../domain/types.js';

export interface TrackingRepository {
  issue(entityType: string, trackingId: string, issuedBy: string | null, executor?: QueryExecutor): Promise<TrackingIdRecord>;
  findByTrackingId(trackingId: string, executor?: QueryExecutor): Promise<TrackingIdRecord | null>;
}
