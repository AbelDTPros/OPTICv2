import { parseScanPayload } from '../../../../src/modules/tracking/domain/scan-payload.js';
import { getCurrentOfficerId } from '../actors/demo-officers.js';
import { SearchApiError, apiErrorFromPayload } from '../api/api-error.js';

export { SearchApiError } from '../api/api-error.js';
import { scanWorkflow, type WorkflowSummary } from '../designers/workflow-api.js';

export interface SearchHit {
  trackingId: string;
  entityType: string;
  definitionKey: string;
  version: string;
  currentStageKey: string;
  assignedTo: string | null;
  slaState: string | null;
  rowVersion: number;
  matchedFields: Array<{ fieldKey: string; value: string; pii: boolean }>;
}

export interface SearchPage {
  q: string;
  receiptNumber?: string;
  page: number;
  pageSize: number;
  total: number;
  hits: SearchHit[];
}

export async function searchRecords(query: {
  q?: string;
  receiptNumber?: string;
  entityType?: string;
  definitionKey?: string;
  currentStageKey?: string;
  assignedTo?: string;
  criteria?: Record<string, string>;
  page?: number;
}): Promise<SearchPage> {
  const params = new URLSearchParams();
  if (query.q) {
    params.set('q', query.q);
  }
  if (query.receiptNumber) {
    params.set('receiptNumber', query.receiptNumber);
  }
  if (query.entityType) {
    params.set('entityType', query.entityType);
  }
  if (query.definitionKey) {
    params.set('definitionKey', query.definitionKey);
  }
  if (query.currentStageKey) {
    params.set('currentStageKey', query.currentStageKey);
  }
  if (query.assignedTo) {
    params.set('assignedTo', query.assignedTo);
  }
  const criteria = Object.fromEntries(
    Object.entries(query.criteria ?? {}).filter(([, value]) => value.trim())
  );
  if (Object.keys(criteria).length > 0) {
    params.set('criteria', JSON.stringify(criteria));
  }
  if (query.page) {
    params.set('page', String(query.page));
  }
  params.set('pageSize', '25');
  const response = await fetch(`/api/v1/search?${params.toString()}`, {
    headers: {
      Authorization: 'Bearer dev-token',
      'X-Actor-Id': getCurrentOfficerId()
    }
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const parsed = apiErrorFromPayload(response.status, payload, `Search failed (${response.status}).`);
    throw new SearchApiError(parsed.summary, response.status, {
      errorCode: parsed.errorCode,
      referenceId: parsed.referenceId,
      correlationId: parsed.correlationId,
      details: parsed.details
    });
  }
  const data = payload && typeof payload === 'object' && 'data' in payload ? (payload as { data?: SearchPage }).data : undefined;
  if (!data) {
    throw new SearchApiError('The API returned an empty search response.');
  }
  return data;
}

export async function findCases(query: {
  q?: string;
  receiptNumber?: string;
  entityType?: string;
  /** Limit results to these definition keys (selected Workload Type mail + workload). */
  definitionKeys?: string[];
  currentStageKey?: string;
  assignedTo?: string;
  criteria?: Record<string, string>;
}): Promise<SearchPage> {
  const scope = [...new Set((query.definitionKeys ?? []).map((key) => key.trim()).filter(Boolean))];
  const page =
    scope.length === 0
      ? await searchRecords(query)
      : scope.length === 1
        ? await searchRecords({ ...query, definitionKey: scope[0] })
        : mergeSearchPages(
            await Promise.all(scope.map((definitionKey) => searchRecords({ ...query, definitionKey })))
          );
  if (!(query.q ?? '').trim() || page.hits.length > 0) {
    return page;
  }
  try {
    const scanned = await scanWorkflow(query.q!.trim());
    const hits = scanned.matches
      .map(summaryToHit)
      .filter((hit) => scope.length === 0 || scope.includes(hit.definitionKey));
    return {
      q: query.q ?? '',
      receiptNumber: query.receiptNumber,
      page: 1,
      pageSize: 25,
      total: hits.length,
      hits
    };
  } catch {
    return page;
  }
}

function mergeSearchPages(pages: SearchPage[]): SearchPage {
  const seen = new Set<string>();
  const hits: SearchHit[] = [];
  for (const page of pages) {
    for (const hit of page.hits) {
      const key = `${hit.entityType}:${hit.trackingId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      hits.push(hit);
    }
  }
  const first = pages[0];
  return {
    q: first?.q ?? '',
    receiptNumber: first?.receiptNumber,
    page: 1,
    pageSize: 25,
    total: hits.length,
    hits: hits.slice(0, 25)
  };
}

export function shouldOpenSingleHit(hits: SearchHit[], rawQuery: string): boolean {
  if (hits.length !== 1) {
    return false;
  }
  const parsed = parseScanPayload(rawQuery);
  const needle = (parsed?.trackingId ?? rawQuery).trim().toLowerCase();
  if (parsed?.entityType) {
    return true;
  }
  return hits[0]!.trackingId.toLowerCase() === needle;
}

function summaryToHit(summary: WorkflowSummary): SearchHit {
  return {
    trackingId: summary.trackingId,
    entityType: summary.entityType,
    definitionKey: summary.definition.definitionKey,
    version: summary.definition.version,
    currentStageKey: summary.workflow.currentStageKey,
    assignedTo: summary.workflow.assignedTo,
    slaState: null,
    rowVersion: summary.workflow.rowVersion,
    matchedFields: [{ fieldKey: 'trackingId', value: summary.trackingId, pii: false }]
  };
}
