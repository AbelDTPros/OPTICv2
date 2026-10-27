import { validationFailed } from '../../../platform/errors/app-error.js';
import type { WorkflowDefinition } from '../domain/types.js';
import type { DefinitionChildKind } from '../persistence/definition.repository.js';
import {
  checksumCanonicalPackage,
  type CanonicalPackage
} from './canonical-package.js';

export type ImportedChildRows = Record<DefinitionChildKind, Array<{ stableKey: string; config: Record<string, unknown> }>>;

export function parseCanonicalPackage(value: unknown): CanonicalPackage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw validationFailed('OPTIC-CONFIG-40027', 'Import package must be a DefinitionRelease object.');
  }
  const record = value as Record<string, unknown>;
  if (record.apiVersion !== 'optic.uscis/v1' || record.kind !== 'DefinitionRelease') {
    throw validationFailed(
      'OPTIC-CONFIG-40027',
      'Import package must have apiVersion optic.uscis/v1 and kind DefinitionRelease.'
    );
  }
  const metadata = record.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw validationFailed('OPTIC-CONFIG-40027', 'Import package metadata is required.');
  }
  const meta = metadata as Record<string, unknown>;
  for (const field of ['definitionKey', 'displayName', 'entityType', 'version'] as const) {
    if (typeof meta[field] !== 'string' || !(meta[field] as string).trim()) {
      throw validationFailed('OPTIC-CONFIG-40027', `Import package metadata.${field} is required.`);
    }
  }
  const spec = record.spec;
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw validationFailed('OPTIC-CONFIG-40027', 'Import package spec is required.');
  }
  return value as CanonicalPackage;
}

export function verifyPackageChecksum(
  pkg: CanonicalPackage,
  checksum: string,
  algorithm: string = 'SHA-256'
): { checksum: string; algorithm: 'SHA-256' } {
  if (algorithm !== 'SHA-256') {
    throw validationFailed('OPTIC-CONFIG-40028', 'Only SHA-256 package checksums are supported.');
  }
  const expected = checksum.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) {
    throw validationFailed('OPTIC-CONFIG-40028', 'Package checksum must be a 64-character hex SHA-256 digest.');
  }
  const signed = checksumCanonicalPackage(pkg);
  if (signed.checksum !== expected) {
    throw validationFailed(
      'OPTIC-CONFIG-40028',
      'Package checksum does not match the canonical package contents.',
      [{ field: 'checksum', expected, received: signed.checksum }]
    );
  }
  return { checksum: signed.checksum, algorithm: 'SHA-256' };
}

export function childrenFromCanonicalPackage(pkg: CanonicalPackage): ImportedChildRows {
  const workflow = (pkg.spec.workflow ?? {}) as Partial<WorkflowDefinition>;
  const stages = Array.isArray(workflow.stages) ? workflow.stages : [];
  const transitionSets = Array.isArray(workflow.transitionSets) ? workflow.transitionSets : [];
  const search = pkg.spec.search as { searchKey?: string } | undefined;

  return {
    stage: stages.map((stage) => ({
      stableKey: String((stage as { stageKey?: string }).stageKey ?? ''),
      config: stage as unknown as Record<string, unknown>
    })).filter((row) => row.stableKey),
    transition: transitionSets.map((set) => ({
      stableKey: String((set as { transitionSetKey?: string }).transitionSetKey ?? ''),
      config: set as unknown as Record<string, unknown>
    })).filter((row) => row.stableKey),
    form: mapRecordChildren(pkg.spec.forms, 'formKey'),
    action: mapRecordChildren(pkg.spec.actions, 'actionKey'),
    queue: mapRecordChildren(pkg.spec.queues, 'queueKey'),
    bulkAction: mapRecordChildren(pkg.spec.bulkActions, 'bulkActionKey'),
    scheduledAction: mapRecordChildren(pkg.spec.scheduledActions, 'scheduledActionKey'),
    sla: mapRecordChildren(pkg.spec.slas, 'slaKey'),
    search:
      search && typeof search === 'object'
        ? [
            {
              stableKey: typeof search.searchKey === 'string' && search.searchKey ? search.searchKey : 'DEFAULT',
              config: search as Record<string, unknown>
            }
          ]
        : []
  };
}

export function workflowGraphFromPackage(pkg: CanonicalPackage): {
  initialStageKey: string;
  terminalStageKeys: string[];
} {
  const workflow = (pkg.spec.workflow ?? {}) as Partial<WorkflowDefinition>;
  return {
    initialStageKey: typeof workflow.initialStageKey === 'string' ? workflow.initialStageKey : '',
    terminalStageKeys: Array.isArray(workflow.terminalStageKeys)
      ? workflow.terminalStageKeys.filter((item): item is string => typeof item === 'string')
      : []
  };
}

function mapRecordChildren(
  value: unknown,
  keyField: string
): Array<{ stableKey: string; config: Record<string, unknown> }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  return Object.entries(value as Record<string, unknown>)
    .map(([fallbackKey, config]) => {
      const record =
        config && typeof config === 'object' && !Array.isArray(config)
          ? (config as Record<string, unknown>)
          : {};
      const fromField = record[keyField];
      const stableKey =
        typeof fromField === 'string' && fromField ? fromField : fallbackKey;
      return { stableKey, config: { ...record, [keyField]: stableKey } };
    })
    .filter((row) => Boolean(row.stableKey));
}
