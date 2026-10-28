/** Human-readable SLA clock labels (not color-only). */
export function formatSlaStateLabel(state: string | null | undefined): string | null {
  if (state == null) {
    return null;
  }
  const normalized = String(state).trim().toUpperCase();
  if (!normalized) {
    return null;
  }
  switch (normalized) {
    case 'ON_TRACK':
      return 'On track';
    case 'WARNING':
      return 'Warning';
    case 'BREACHED':
    case 'PAST':
    case 'PAST_SLA':
      return 'Past SLA';
    case 'PAUSED':
      return 'Paused';
    default:
      return String(state);
  }
}

export type SlaTone = 'ok' | 'watch' | 'critical' | 'paused' | 'neutral';

export function slaStateTone(state: string | null | undefined): SlaTone {
  const normalized = String(state ?? '')
    .trim()
    .toUpperCase();
  if (normalized === 'ON_TRACK') {
    return 'ok';
  }
  if (normalized === 'WARNING') {
    return 'watch';
  }
  if (normalized === 'BREACHED' || normalized === 'PAST' || normalized === 'PAST_SLA') {
    return 'critical';
  }
  if (normalized === 'PAUSED') {
    return 'paused';
  }
  return 'neutral';
}
