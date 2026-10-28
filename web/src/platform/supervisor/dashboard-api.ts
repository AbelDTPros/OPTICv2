import { DesignerApiError } from '../api/api-error.js';
import { readDesignerData } from '../designers/config-api.js';

export interface SupervisorDashboardDimension {
  fieldKey: string;
  label: string;
  match: string;
}

export interface SupervisorDashboard {
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
  assignees: Array<{
    assignedTo: string | null;
    label: string;
    count: number;
    lateCount: number;
    oldestAgeMinutes: number | null;
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

export async function fetchSupervisorDashboard(
  definitionKeys: string[],
  activityLimit = 50,
  filters: Record<string, string> = {}
): Promise<SupervisorDashboard> {
  const params = new URLSearchParams();
  for (const key of definitionKeys) {
    params.append('definitionKey', key);
  }
  params.set('activityLimit', String(activityLimit));
  for (const [fieldKey, value] of Object.entries(filters)) {
    const trimmed = value.trim();
    if (trimmed) {
      params.set(`filter.${fieldKey}`, trimmed);
    }
  }
  return api(`/api/v1/supervisor/dashboard?${params.toString()}`);
}

async function api<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      headers: {
        Authorization: 'Bearer dev-token',
        'X-Actor-Id': 'supervisor@example.gov',
        'X-Actor-Roles': 'SUPERVISOR'
      }
    });
  } catch {
    throw new DesignerApiError('The browser could not reach /api for the supervisor dashboard.');
  }
  return readDesignerData<T>(response.status, response.ok, await readJson(response));
}

async function readJson(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
