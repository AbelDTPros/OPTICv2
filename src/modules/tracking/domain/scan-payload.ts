export const SCAN_PREFIX = 'OPTIC';

export interface ScanTarget {
  entityType?: string;
  trackingId: string;
}

export function buildScanPayload(entityType: string, trackingId: string): string {
  return `${SCAN_PREFIX}:${entityType.trim().toUpperCase()}:${trackingId.trim()}`;
}

export function parseScanPayload(raw: string): ScanTarget | undefined {
  const value = raw.trim();
  if (!value) {
    return undefined;
  }
  const parts = value.split(':');
  if (parts.length >= 3 && parts[0]?.toUpperCase() === SCAN_PREFIX) {
    const entityType = parts[1]?.trim().toUpperCase();
    const trackingId = parts.slice(2).join(':').trim();
    if (trackingId && (entityType === 'MAIL' || entityType === 'WORKLOAD')) {
      return { entityType, trackingId };
    }
  }
  return { trackingId: value };
}
