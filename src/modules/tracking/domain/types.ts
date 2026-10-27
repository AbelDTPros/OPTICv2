export interface TrackingIdRecord {
  trackingId: string;
  entityType: string;
  issuedBy: string | null;
  issuedAt: Date;
}
