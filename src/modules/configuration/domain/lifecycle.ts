import { conflict } from '../../../platform/errors/app-error.js';
import type { DefinitionLifecycle } from './types.js';

export const AUTHORABLE_STATUSES: ReadonlySet<DefinitionLifecycle> = new Set(['DRAFT']);

const ALLOWED_TRANSITIONS: Record<DefinitionLifecycle, DefinitionLifecycle[]> = {
  DRAFT: ['IN_REVIEW'],
  IN_REVIEW: ['APPROVED', 'REJECTED', 'DRAFT'],
  REJECTED: ['DRAFT'],
  APPROVED: ['PUBLISHED'],
  PUBLISHED: ['RETIRED'],
  RETIRED: ['PUBLISHED']
};

export function assertDraftOnly(status: DefinitionLifecycle, operation: string): void {
  if (!AUTHORABLE_STATUSES.has(status)) {
    throw conflict(
      'OPTIC-CONFIG-40902',
      `Release is ${status} and cannot be modified. ${operation} is allowed only for DRAFT releases.`,
      [{ lifecycleStatus: status, operation }]
    );
  }
}

export function createDraftManifest(input: {
  definitionKey: string;
  displayName: string;
  entityType: string;
  version: string;
  createdBy: string;
  createdAt: string;
}): Record<string, unknown> {
  return {
    apiVersion: 'optic.uscis/v1',
    kind: 'DefinitionRelease',
    metadata: {
      definitionKey: input.definitionKey,
      displayName: input.displayName,
      entityType: input.entityType,
      version: input.version,
      status: 'DRAFT',
      createdAt: input.createdAt,
      createdBy: input.createdBy
    },
    spec: {
      workflow: 'workflow.yaml',
      dataSchema: 'schemas/workload.schema.json',
      queues: 'queues.yaml',
      actions: 'actions.yaml',
      bulkActions: 'bulk-actions.yaml',
      scheduledActions: 'scheduled-actions.yaml',
      sla: 'sla.yaml',
      search: 'search.yaml',
      uiDirectory: 'ui/',
      schemaDirectory: 'schemas/'
    }
  };
}

export function readSchemaFromManifest(manifest: Record<string, unknown>): Record<string, unknown> {
  const spec = (manifest.spec ?? {}) as Record<string, unknown>;
  if (spec.dataSchema && typeof spec.dataSchema === 'object' && !Array.isArray(spec.dataSchema)) {
    return spec.dataSchema as Record<string, unknown>;
  }
  return {};
}

export function writeSchemaToManifest(
  manifest: Record<string, unknown>,
  schema: Record<string, unknown>
): Record<string, unknown> {
  const spec = { ...((manifest.spec ?? {}) as Record<string, unknown>), dataSchema: schema };
  return { ...manifest, spec };
}

export function assertLifecycleTransition(
  from: DefinitionLifecycle,
  to: DefinitionLifecycle,
  operation: string
): void {
  if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
    throw conflict(
      'OPTIC-CONFIG-40903',
      `Cannot ${operation}: release is ${from}.`,
      [{ lifecycleStatus: from, operation, targetStatus: to }]
    );
  }
}

export function withManifestLifecycle(
  manifest: Record<string, unknown>,
  status: DefinitionLifecycle,
  extras: Record<string, unknown> = {}
): Record<string, unknown> {
  const metadata = {
    ...((manifest.metadata ?? {}) as Record<string, unknown>),
    status,
    ...extras
  };
  return { ...manifest, metadata };
}
