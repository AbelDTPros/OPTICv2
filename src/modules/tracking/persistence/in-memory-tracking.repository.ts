import { conflict } from '../../../platform/errors/app-error.js';
import type { TrackingIdRecord } from '../domain/types.js';
import type { TrackingRepository } from './tracking.repository.js';

export class InMemoryTrackingRepository implements TrackingRepository {
  private readonly issued = new Map<string, TrackingIdRecord>();

  async issue(entityType: string, trackingId: string, issuedBy: string | null): Promise<TrackingIdRecord> {
    if (this.issued.has(trackingId)) {
      throw conflict('OPTIC-WF-40910', `Tracking id ${trackingId} was already issued.`);
    }
    const record: TrackingIdRecord = {
      trackingId,
      entityType,
      issuedBy,
      issuedAt: new Date()
    };
    this.issued.set(trackingId, record);
    return { ...record };
  }

  async findByTrackingId(trackingId: string): Promise<TrackingIdRecord | null> {
    const record = this.issued.get(trackingId);
    return record ? { ...record } : null;
  }
}
