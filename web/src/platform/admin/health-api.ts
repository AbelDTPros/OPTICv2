export type HealthCheckState = 'up' | 'down' | 'unknown';

export interface HealthSnapshot {
  status: 'ok' | 'unavailable' | 'unreachable';
  process: HealthCheckState;
  database: HealthCheckState;
  httpStatus?: number;
}

interface HealthPayload {
  status?: string;
  checks?: {
    process?: string;
    database?: string;
  };
}

function asCheck(value: string | undefined): HealthCheckState {
  if (value === 'up' || value === 'down') {
    return value;
  }
  return 'unknown';
}

export async function fetchHealthReady(): Promise<HealthSnapshot> {
  let response: Response;
  try {
    response = await fetch('/health/ready');
  } catch {
    return { status: 'unreachable', process: 'unknown', database: 'unknown' };
  }

  let payload: HealthPayload | null = null;
  try {
    payload = (await response.json()) as HealthPayload;
  } catch {
    payload = null;
  }

  const status =
    payload?.status === 'ok' ? 'ok' : payload?.status === 'unavailable' ? 'unavailable' : 'unreachable';

  return {
    status: response.ok || response.status === 503 ? status : 'unreachable',
    process: asCheck(payload?.checks?.process),
    database: asCheck(payload?.checks?.database),
    httpStatus: response.status
  };
}
