import { DesignerApiError, apiErrorFromPayload, isOpticErrorPayload } from '../api/api-error.js';
import type {
  ActionDefinition,
  BulkActionDefinition,
  DefinitionLifecycle,
  JsonSchema,
  QueueDefinition,
  ScheduledActionDefinition,
  SearchDefinition,
  SlaDefinition,
  StageFormDefinition,
  WorkflowDefinition
} from '../../../../src/modules/configuration/domain/types.js';

export { DesignerApiError } from '../api/api-error.js';

const ACTOR_ID = 'configurator@example.gov';

export interface DesignerRelease {
  definitionKey: string;
  displayName: string;
  entityType?: string;
  version: string;
  lifecycleStatus: DefinitionLifecycle;
  rowVersion: number;
  workflow: WorkflowDefinition;
  forms: Record<string, StageFormDefinition>;
  schema?: JsonSchema;
  actions?: Record<string, ActionDefinition>;
  queues?: Record<string, QueueDefinition>;
  slas?: Record<string, SlaDefinition>;
  bulkActions?: Record<string, BulkActionDefinition>;
  scheduledActions?: Record<string, ScheduledActionDefinition>;
  search?: SearchDefinition;
  /** True when this release is the Live pointer. Status stays PUBLISHED. */
  active?: boolean;
}

export interface SimulateTransitionResult {
  definitionKey: string;
  version: string;
  transitionSetKey: string;
  targetStageKey: string;
  matchedRuleKey?: string;
  usedDefault: boolean;
  trace: Array<{
    ruleKey?: string;
    path?: string;
    operator?: string;
    result: string;
    message?: string;
  }>;
}

export interface SemanticDiffResult {
  fromVersion: string;
  toVersion: string;
  changes: Array<{
    category: string;
    change: string;
    key: string;
    path?: string;
  }>;
}

export interface ReleaseCatalogItem {
  definitionKey: string;
  displayName: string;
  entityType?: string;
  version: string;
  lifecycleStatus: DefinitionLifecycle;
  /** True when this release is the Live pointer. Status stays PUBLISHED. */
  active?: boolean;
}

export async function listDefinitions(): Promise<
  Array<{ definitionKey: string; displayName: string; entityType?: string }>
> {
  return api('/api/v1/config/definitions');
}

export async function listReleaseCatalog(): Promise<ReleaseCatalogItem[]> {
  return api('/api/v1/config/releases');
}

export async function createDefinition(body: {
  definitionKey: string;
  displayName: string;
  entityType: string;
}): Promise<void> {
  try {
    await api('/api/v1/config/definitions', { method: 'POST', body: JSON.stringify(body) });
  } catch (error) {
    if (isConfigConflict(error)) {
      return;
    }
    throw error;
  }
}

export async function createDraftRelease(
  definitionKey: string,
  version: string,
  cloneFrom?: { definitionKey?: string; version: string }
): Promise<DesignerRelease> {
  try {
    return await api(`/api/v1/config/definitions/${encodeURIComponent(definitionKey)}/releases`, {
      method: 'POST',
      body: JSON.stringify({
        version,
        ...(cloneFrom?.version
          ? {
              cloneFromVersion: cloneFrom.version,
              ...(cloneFrom.definitionKey ? { cloneFromDefinitionKey: cloneFrom.definitionKey } : {})
            }
          : {})
      })
    });
  } catch (error) {
    if (isConfigConflict(error)) {
      return getRelease(definitionKey, version);
    }
    throw error;
  }
}

export async function getRelease(definitionKey: string, version: string): Promise<DesignerRelease> {
  return api(`/api/v1/config/definitions/${encodeURIComponent(definitionKey)}/releases/${encodeURIComponent(version)}`);
}

export async function deleteDraftRelease(
  definitionKey: string,
  version: string,
  expectedRowVersion: number
): Promise<{ definitionKey: string; version: string; definitionRemoved: boolean }> {
  return api(
    `/api/v1/config/definitions/${encodeURIComponent(definitionKey)}/releases/${encodeURIComponent(version)}`,
    {
      method: 'DELETE',
      body: JSON.stringify({ expectedRowVersion })
    }
  );
}

export async function saveWorkflowDraft(
  definitionKey: string,
  version: string,
  expectedRowVersion: number,
  workflow: WorkflowDefinition
): Promise<DesignerRelease> {
  return api(`/api/v1/config/definitions/${encodeURIComponent(definitionKey)}/releases/${encodeURIComponent(version)}/workflow`, {
    method: 'PUT',
    body: JSON.stringify({ expectedRowVersion, workflow })
  });
}

export async function deleteFormDraft(
  definitionKey: string,
  version: string,
  expectedRowVersion: number,
  formKey: string
): Promise<DesignerRelease> {
  return api(
    `/api/v1/config/definitions/${encodeURIComponent(definitionKey)}/releases/${encodeURIComponent(version)}/forms/${encodeURIComponent(formKey)}`,
    {
      method: 'DELETE',
      body: JSON.stringify({ expectedRowVersion })
    }
  );
}

export async function saveFormDraft(
  definitionKey: string,
  version: string,
  expectedRowVersion: number,
  form: StageFormDefinition
): Promise<DesignerRelease> {
  return api(
    `/api/v1/config/definitions/${encodeURIComponent(definitionKey)}/releases/${encodeURIComponent(version)}/forms/${encodeURIComponent(form.formKey)}`,
    {
      method: 'PUT',
      body: JSON.stringify({ expectedRowVersion, payload: form })
    }
  );
}

export async function saveActionDraft(
  definitionKey: string,
  version: string,
  expectedRowVersion: number,
  action: ActionDefinition
): Promise<DesignerRelease> {
  return api(
    `/api/v1/config/definitions/${encodeURIComponent(definitionKey)}/releases/${encodeURIComponent(version)}/actions/${encodeURIComponent(action.actionKey)}`,
    { method: 'PUT', body: JSON.stringify({ expectedRowVersion, payload: action }) }
  );
}

export async function deleteActionDraft(
  definitionKey: string,
  version: string,
  expectedRowVersion: number,
  actionKey: string
): Promise<DesignerRelease> {
  return api(
    `/api/v1/config/definitions/${encodeURIComponent(definitionKey)}/releases/${encodeURIComponent(version)}/actions/${encodeURIComponent(actionKey)}`,
    { method: 'DELETE', body: JSON.stringify({ expectedRowVersion }) }
  );
}

export async function saveQueueDraft(
  definitionKey: string,
  version: string,
  expectedRowVersion: number,
  queue: QueueDefinition
): Promise<DesignerRelease> {
  return api(
    `/api/v1/config/definitions/${encodeURIComponent(definitionKey)}/releases/${encodeURIComponent(version)}/queues/${encodeURIComponent(queue.queueKey)}`,
    { method: 'PUT', body: JSON.stringify({ expectedRowVersion, payload: queue }) }
  );
}

export async function deleteQueueDraft(
  definitionKey: string,
  version: string,
  expectedRowVersion: number,
  queueKey: string
): Promise<DesignerRelease> {
  return api(
    `/api/v1/config/definitions/${encodeURIComponent(definitionKey)}/releases/${encodeURIComponent(version)}/queues/${encodeURIComponent(queueKey)}`,
    { method: 'DELETE', body: JSON.stringify({ expectedRowVersion }) }
  );
}

export async function saveSlaDraft(
  definitionKey: string,
  version: string,
  expectedRowVersion: number,
  sla: SlaDefinition
): Promise<DesignerRelease> {
  return api(
    `/api/v1/config/definitions/${encodeURIComponent(definitionKey)}/releases/${encodeURIComponent(version)}/slas/${encodeURIComponent(sla.slaKey)}`,
    { method: 'PUT', body: JSON.stringify({ expectedRowVersion, payload: sla }) }
  );
}

export async function deleteSlaDraft(
  definitionKey: string,
  version: string,
  expectedRowVersion: number,
  slaKey: string
): Promise<DesignerRelease> {
  return api(
    `/api/v1/config/definitions/${encodeURIComponent(definitionKey)}/releases/${encodeURIComponent(version)}/slas/${encodeURIComponent(slaKey)}`,
    { method: 'DELETE', body: JSON.stringify({ expectedRowVersion }) }
  );
}

export async function saveSearchDraft(
  definitionKey: string,
  version: string,
  expectedRowVersion: number,
  search: SearchDefinition
): Promise<DesignerRelease> {
  return api(`/api/v1/config/definitions/${encodeURIComponent(definitionKey)}/releases/${encodeURIComponent(version)}/search`, {
    method: 'PUT',
    body: JSON.stringify({ expectedRowVersion, payload: search })
  });
}

export async function saveBulkActionDraft(
  definitionKey: string,
  version: string,
  expectedRowVersion: number,
  bulk: BulkActionDefinition
): Promise<DesignerRelease> {
  return api(
    `/api/v1/config/definitions/${encodeURIComponent(definitionKey)}/releases/${encodeURIComponent(version)}/bulk-actions/${encodeURIComponent(bulk.bulkActionKey)}`,
    { method: 'PUT', body: JSON.stringify({ expectedRowVersion, payload: bulk }) }
  );
}

export async function deleteBulkActionDraft(
  definitionKey: string,
  version: string,
  expectedRowVersion: number,
  bulkActionKey: string
): Promise<DesignerRelease> {
  return api(
    `/api/v1/config/definitions/${encodeURIComponent(definitionKey)}/releases/${encodeURIComponent(version)}/bulk-actions/${encodeURIComponent(bulkActionKey)}`,
    { method: 'DELETE', body: JSON.stringify({ expectedRowVersion }) }
  );
}

export async function saveScheduledActionDraft(
  definitionKey: string,
  version: string,
  expectedRowVersion: number,
  scheduled: ScheduledActionDefinition
): Promise<DesignerRelease> {
  return api(
    `/api/v1/config/definitions/${encodeURIComponent(definitionKey)}/releases/${encodeURIComponent(version)}/scheduled-actions/${encodeURIComponent(scheduled.scheduledActionKey)}`,
    { method: 'PUT', body: JSON.stringify({ expectedRowVersion, payload: scheduled }) }
  );
}

export async function deleteScheduledActionDraft(
  definitionKey: string,
  version: string,
  expectedRowVersion: number,
  scheduledActionKey: string
): Promise<DesignerRelease> {
  return api(
    `/api/v1/config/definitions/${encodeURIComponent(definitionKey)}/releases/${encodeURIComponent(version)}/scheduled-actions/${encodeURIComponent(scheduledActionKey)}`,
    { method: 'DELETE', body: JSON.stringify({ expectedRowVersion }) }
  );
}

export interface ValidateReleaseResult {
  valid: boolean;
  definitionKey: string;
  version: string;
  projections: Array<{ key: string; source: string; field: string; sqlColumn: string; usedBy: string[] }>;
}

export async function validateRelease(definitionKey: string, version: string): Promise<ValidateReleaseResult> {
  return api(
    `/api/v1/config/definitions/${encodeURIComponent(definitionKey)}/releases/${encodeURIComponent(version)}/validate`,
    { method: 'POST', body: JSON.stringify({}) }
  );
}

export interface ExportedReleasePackage {
  package: Record<string, unknown>;
  checksum: string | null;
  checksumAlgorithm: string | null;
  files: Record<string, string>;
}

export async function exportReleasePackage(
  definitionKey: string,
  version: string
): Promise<ExportedReleasePackage> {
  return api(
    `/api/v1/config/definitions/${encodeURIComponent(definitionKey)}/releases/${encodeURIComponent(version)}/export`
  );
}

export async function importReleasePackage(
  definitionKey: string,
  body: {
    package: Record<string, unknown>;
    checksum: string;
    checksumAlgorithm?: 'SHA-256';
    version?: string;
    mode?: 'DRAFT' | 'PUBLISHED';
    createDefinitionIfMissing?: boolean;
  },
  actorId = ACTOR_ID
): Promise<DesignerRelease> {
  return api(`/api/v1/config/definitions/${encodeURIComponent(definitionKey)}/releases/import`, {
    method: 'POST',
    headers: { 'X-Actor-Id': actorId },
    body: JSON.stringify(body)
  });
}

export async function mutateLifecycle(
  definitionKey: string,
  version: string,
  operation:
    | 'submit'
    | 'approve'
    | 'reject'
    | 'return-to-draft'
    | 'publish'
    | 'retire'
    | 'activate'
    | 'deactivate',
  expectedRowVersion: number,
  actorId: string,
  comment?: string
): Promise<DesignerRelease> {
  const path =
    operation === 'activate' || operation === 'deactivate'
      ? `/api/v1/config/definitions/${encodeURIComponent(definitionKey)}/${operation}/${encodeURIComponent(version)}`
      : `/api/v1/config/definitions/${encodeURIComponent(definitionKey)}/releases/${encodeURIComponent(version)}/${operation}`;
  return api(path, {
    method: 'POST',
    headers: { 'X-Actor-Id': actorId, 'X-Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ expectedRowVersion, comment: comment?.trim() || undefined })
  });
}

export async function saveSchemaDraft(
  definitionKey: string,
  version: string,
  expectedRowVersion: number,
  schema: JsonSchema
): Promise<DesignerRelease> {
  return api(`/api/v1/config/definitions/${encodeURIComponent(definitionKey)}/releases/${encodeURIComponent(version)}/schema`, {
    method: 'PUT',
    body: JSON.stringify({ expectedRowVersion, payload: schema })
  });
}

export async function simulateTransition(
  definitionKey: string,
  version: string,
  body: { transitionSetKey: string; businessData?: unknown; workflowContext?: Record<string, unknown> }
): Promise<SimulateTransitionResult> {
  return api(`/api/v1/config/definitions/${encodeURIComponent(definitionKey)}/releases/${encodeURIComponent(version)}/simulate`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

export async function diffReleases(
  definitionKey: string,
  fromVersion: string,
  toVersion: string
): Promise<SemanticDiffResult> {
  return api(
    `/api/v1/config/definitions/${encodeURIComponent(definitionKey)}/releases/${encodeURIComponent(fromVersion)}/diff/${encodeURIComponent(toVersion)}`
  );
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: 'Bearer dev-token',
    'X-Actor-Id': ACTOR_ID,
    ...(init.headers as Record<string, string> | undefined)
  };
  if (init.body) {
    headers['Content-Type'] = 'application/json';
  }
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers
    });
  } catch {
    throw new DesignerApiError(DESIGNER_API_UNREACHABLE);
  }
  return readDesignerData<T>(response.status, response.ok, await readJson(response));
}

export const DESIGNER_API_UNREACHABLE =
  'The browser could not reach /api. Reload the Designer from the URL printed by `npm run dev:web` (a tab left open after restart will fail), and keep `npm run dev` running.';

export function readDesignerData<T>(status: number, ok: boolean, payload: unknown): T {
  if (isOpticErrorPayload(payload)) {
    const parsed = apiErrorFromPayload(status, payload, `Request failed (${status}).`);
    throw new DesignerApiError(
      parsed.summary,
      status,
      parsed.errorCode,
      parsed.details,
      { referenceId: parsed.referenceId, correlationId: parsed.correlationId }
    );
  }
  if (ok && payload && typeof payload === 'object' && 'data' in payload && (payload as { data?: T }).data !== undefined) {
    return (payload as { data: T }).data;
  }
  throw new DesignerApiError(unexpectedApiResponse(status, payload), status);
}

function unexpectedApiResponse(status: number, payload: unknown): string {
  if (payload && typeof payload === 'object' && 'detail' in payload) {
    return `Port proxy target is not OPTIC (HTTP ${status}: ${String((payload as { detail: unknown }).detail)}).`;
  }
  if (payload == null) {
    return `Unexpected /api response (HTTP ${status}, empty or HTML). Vite served the app shell instead of the OPTIC API — restart npm run dev:web.`;
  }
  return `Unexpected /api response (HTTP ${status}). Vite should proxy to the OPTIC API on PORT from .env.`;
}

function isConfigConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = 'errorCode' in error ? String((error as { errorCode?: unknown }).errorCode) : '';
  const status = 'status' in error ? Number((error as { status?: unknown }).status) : undefined;
  return code === 'OPTIC-CONFIG-40901' || status === 409;
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

