import { getCurrentOfficerId } from '../actors/demo-officers.js';
import { OpticApiError, apiErrorFromPayload } from '../api/api-error.js';
import type { DemoBulkResult, DemoQueuePage } from './demo-queue.js';

export { OpticApiError } from '../api/api-error.js';

export interface CatalogedQueueRow {
  queueKey: string;
  displayName: string;
  entityType: string;
  definitionKey: string;
  version: string;
  /** Stage-order index within the definition; Live sidebar sorts by this. */
  officerSortIndex?: number;
  total?: number;
}

export async function listLiveQueues(): Promise<CatalogedQueueRow[]> {
  const page = await api<{ queues: CatalogedQueueRow[] }>('/api/v1/queues');
  return page.queues ?? [];
}

export async function fetchQueuePage(
  queueKey: string,
  query: {
    definitionKey?: string;
    page?: number;
    sort?: string;
    direction?: string;
    filters?: Record<string, string>;
  } = {}
): Promise<DemoQueuePage> {
  const params = new URLSearchParams();
  if (query.definitionKey) {
    params.set('definitionKey', query.definitionKey);
  }
  if (query.page) {
    params.set('page', String(query.page));
  }
  if (query.sort) {
    params.set('sort', query.sort);
  }
  if (query.direction) {
    params.set('direction', query.direction);
  }
  for (const [key, value] of Object.entries(query.filters ?? {})) {
    if (value) {
      params.set(key, value);
    }
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return api<DemoQueuePage>(`/api/v1/queues/${encodeURIComponent(queueKey)}${suffix}`);
}

export async function assignFromQueue(
  queueKey: string,
  item: { entityType: string; trackingId: string; expectedRowVersion: number; definitionKey?: string }
): Promise<void> {
  await api(`/api/v1/queues/${encodeURIComponent(queueKey)}/assign`, {
    method: 'POST',
    body: JSON.stringify(item)
  });
}

export async function releaseFromQueue(
  queueKey: string,
  item: { entityType: string; trackingId: string; expectedRowVersion: number; definitionKey?: string }
): Promise<void> {
  await api(`/api/v1/queues/${encodeURIComponent(queueKey)}/release`, {
    method: 'POST',
    body: JSON.stringify(item)
  });
}

export async function reassignFromQueue(
  queueKey: string,
  item: { entityType: string; trackingId: string; expectedRowVersion: number; assignedTo: string; definitionKey?: string }
): Promise<void> {
  await api(`/api/v1/queues/${encodeURIComponent(queueKey)}/reassign`, {
    method: 'POST',
    headers: {
      'X-Actor-Id': 'supervisor@example.gov',
      'X-Actor-Roles': 'SUPERVISOR'
    },
    body: JSON.stringify(item)
  });
}

export async function executeBulkAction(
  bulkActionKey: string,
  items: Array<{ entityType: string; trackingId: string; expectedRowVersion: number }>,
  input: Record<string, string>
): Promise<DemoBulkResult> {
  return api<DemoBulkResult>(`/api/v1/bulk-actions/${encodeURIComponent(bulkActionKey)}/execute`, {
    method: 'POST',
    headers: { 'X-Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ items, input })
  });
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Authorization: 'Bearer dev-token',
      'X-Actor-Id': getCurrentOfficerId(),
      'Content-Type': 'application/json',
      ...(init.headers ?? {})
    }
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const parsed = apiErrorFromPayload(response.status, payload, `Request failed (${response.status}).`);
    throw new OpticApiError(parsed.summary, response.status, {
      errorCode: parsed.errorCode,
      referenceId: parsed.referenceId,
      correlationId: parsed.correlationId,
      details: parsed.details
    });
  }
  const data = payload && typeof payload === 'object' && 'data' in payload ? (payload as { data?: T }).data : undefined;
  if (data === undefined) {
    throw new OpticApiError('The API returned an empty response.');
  }
  return data;
}
