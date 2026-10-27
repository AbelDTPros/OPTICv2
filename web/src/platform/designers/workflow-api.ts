import type { JsonSchema, StageFormDefinition, WorkflowDefinition } from '../../../../src/modules/configuration/domain/types.js';
import { getCurrentOfficerId } from '../actors/demo-officers.js';
import { DESIGNER_API_UNREACHABLE, DesignerApiError, readDesignerData } from './config-api.js';

export { OFFICER_ACTOR_ID } from '../actors/demo-officers.js';

export interface WorkflowSummary {
  trackingId: string;
  entityType: string;
  workflowInstanceId: number;
  status: string;
  definition: {
    definitionKey: string;
    version: string;
    releaseId: string;
  };
  workflow: {
    currentStageKey: string;
    currentStageLabel: string;
    enteredStageAt: string;
    assignedTo: string | null;
    rowVersion: number;
    openVisitNumber: number | null;
  };
  businessData: Record<string, unknown>;
  assignmentPermissions?: {
    allowAssign: boolean;
    allowReassign: boolean;
    allowRelease: boolean;
  };
  allowedActions: Array<{ actionKey: string; label: string }>;
  stageForm: {
    formKey: string;
    title: string;
    dataPath: string;
    schema: JsonSchema;
    ui: StageFormDefinition;
  } | null;
  visits: Array<{
    stageKey: string;
    visitNumber: number;
    enteredAt: string;
    completedAt: string | null;
    nextStageKey: string | null;
    enteredBy?: string | null;
    assignedTo?: string | null;
    completedBy?: string | null;
  }>;
  forms?: Record<string, StageFormDefinition>;
  workflowDefinition?: WorkflowDefinition;
  packet?: {
    parent?: WorkflowSummary;
    children?: WorkflowSummary[];
  };
}

export interface WorkflowQueueItem {
  trackingId: string;
  entityType: string;
  workflowInstanceId: number;
  status: string;
  currentStageKey: string;
  currentStageLabel: string;
  assignedTo: string | null;
  enteredStageAt: string;
  rowVersion: number;
  businessData: Record<string, unknown>;
}

export interface WorkflowInstanceList {
  definitionKey: string;
  version: string;
  releaseId: string;
  items: WorkflowQueueItem[];
}

export async function listWorkflowInstances(
  definitionKey: string,
  version: string
): Promise<WorkflowInstanceList> {
  const params = new URLSearchParams({ definitionKey, version });
  return officerApi(`/api/v1/workflows?${params.toString()}`);
}

export async function createWorkflowInstance(body: {
  entityType: string;
  entityTrackingId: string;
  definitionKey: string;
  version?: string;
}): Promise<WorkflowSummary> {
  return officerApi('/api/v1/workflows', {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

export async function getWorkflowSummary(entityType: string, trackingId: string): Promise<WorkflowSummary> {
  return officerApi(
    `/api/v1/workflows/${encodeURIComponent(entityType)}/${encodeURIComponent(trackingId)}`
  );
}

export async function mintTrackingId(entityType: string): Promise<{ trackingId: string; entityType: string }> {
  return officerApi('/api/v1/tracking-ids', {
    method: 'POST',
    body: JSON.stringify({ entityType })
  });
}

export async function scanWorkflow(query: string): Promise<{ query: string; matches: WorkflowSummary[] }> {
  const params = new URLSearchParams({ q: query });
  return officerApi(`/api/v1/workflows/scan?${params.toString()}`);
}

export async function assignWorkflow(
  entityType: string,
  trackingId: string,
  expectedRowVersion: number
): Promise<WorkflowSummary> {
  return officerApi(
    `/api/v1/workflows/${encodeURIComponent(entityType)}/${encodeURIComponent(trackingId)}/assign`,
    { method: 'POST', body: JSON.stringify({ expectedRowVersion }) }
  );
}

export async function reassignWorkflow(
  entityType: string,
  trackingId: string,
  expectedRowVersion: number,
  assignedTo: string
): Promise<WorkflowSummary> {
  return officerApi(
    `/api/v1/workflows/${encodeURIComponent(entityType)}/${encodeURIComponent(trackingId)}/reassign`,
    {
      method: 'POST',
      headers: {
        'X-Actor-Id': 'supervisor@example.gov',
        'X-Actor-Roles': 'SUPERVISOR'
      },
      body: JSON.stringify({ expectedRowVersion, assignedTo })
    }
  );
}

export async function releaseWorkflow(
  entityType: string,
  trackingId: string,
  expectedRowVersion: number,
  asActorId?: string
): Promise<WorkflowSummary> {
  return officerApi(
    `/api/v1/workflows/${encodeURIComponent(entityType)}/${encodeURIComponent(trackingId)}/release`,
    {
      method: 'POST',
      body: JSON.stringify({ expectedRowVersion }),
      headers: asActorId ? { 'X-Actor-Id': asActorId } : undefined
    }
  );
}

export async function saveWorkflowDraft(
  entityType: string,
  trackingId: string,
  expectedRowVersion: number,
  dataPatch: Record<string, unknown>
): Promise<WorkflowSummary> {
  return officerApi(
    `/api/v1/workflows/${encodeURIComponent(entityType)}/${encodeURIComponent(trackingId)}/data`,
    { method: 'PATCH', body: JSON.stringify({ expectedRowVersion, dataPatch }) }
  );
}

export async function executeWorkflowAction(
  entityType: string,
  trackingId: string,
  actionKey: string,
  expectedRowVersion: number,
  dataPatch?: Record<string, unknown>
): Promise<WorkflowSummary> {
  return officerApi(
    `/api/v1/workflows/${encodeURIComponent(entityType)}/${encodeURIComponent(trackingId)}/actions/${encodeURIComponent(actionKey)}`,
    { method: 'POST', body: JSON.stringify({ expectedRowVersion, dataPatch }) }
  );
}

async function officerApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: 'Bearer dev-token',
    'X-Actor-Id': getCurrentOfficerId(),
    'X-Actor-Roles': 'OFFICER',
    ...(init.headers as Record<string, string> | undefined)
  };
  if (init.body) {
    headers['Content-Type'] = 'application/json';
  }
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch {
    throw new DesignerApiError(DESIGNER_API_UNREACHABLE);
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
