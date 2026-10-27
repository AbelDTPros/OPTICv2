import { DesignerApiError } from '../api/api-error.js';
import { readDesignerData } from '../designers/config-api.js';

export interface AuditListItem {
  id: number | null;
  eventId: string;
  eventType: string;
  occurredAt: string;
  actorId: string | null;
  actorName: string | null;
  sessionId: string | null;
  correlationId: string;
  sourceService: string;
  entityType: string | null;
  entityTrackingId: string | null;
  definitionKey: string | null;
  definitionVersion: string | null;
  stageKey: string | null;
  actionKey: string | null;
  previousHash: string | null;
  eventHash: string;
  createdAt: string;
  eventData?: Record<string, unknown>;
}

export interface AuditListQuery {
  eventType?: string;
  actorId?: string;
  entityType?: string;
  entityTrackingId?: string;
  definitionKey?: string;
  correlationId?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface AuditListResult {
  items: AuditListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  admin: { uiEnabled: boolean; apiEnabled: boolean };
}

export interface AuditActorOption {
  value: string;
  label: string;
}

export interface AuditFilterOptions {
  actors: AuditActorOption[];
  definitionKeys: string[];
  admin: { uiEnabled: boolean; apiEnabled: boolean };
}

const ACTOR_ID = 'admin@example.gov';

export async function listAdminAudit(query: AuditListQuery = {}): Promise<AuditListResult> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') {
      params.set(key, String(value));
    }
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return api(`/api/v1/admin/audit${suffix}`);
}

export async function getAdminAuditFilterOptions(): Promise<AuditFilterOptions> {
  return api('/api/v1/admin/audit/filter-options');
}

export async function getAdminAuditEvent(eventId: string): Promise<AuditListItem> {
  return api(`/api/v1/admin/audit/${encodeURIComponent(eventId)}`);
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: 'Bearer dev-token',
    'X-Actor-Id': ACTOR_ID,
    'X-Actor-Roles': 'ADMIN',
    ...(init.headers as Record<string, string> | undefined)
  };
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch {
    throw new DesignerApiError('The browser could not reach /api for audit trail.');
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
