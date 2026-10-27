import { createHash } from 'node:crypto';
import type { DefinitionRelease } from '../domain/types.js';

export interface CanonicalPackage {
  apiVersion: 'optic.uscis/v1';
  kind: 'DefinitionRelease';
  metadata: {
    definitionKey: string;
    displayName: string;
    entityType: string;
    version: string;
    status: string;
    approvedBy: string | null;
    publishedBy: string | null;
    checksumAlgorithm: 'SHA-256';
  };
  spec: {
    schema: Record<string, unknown>;
    workflow: unknown;
    forms: unknown;
    actions: unknown;
    queues: unknown;
    bulkActions: unknown;
    scheduledActions: unknown;
    slas: unknown;
    search: unknown;
  };
}

export function buildCanonicalPackage(
  release: DefinitionRelease,
  extras: { approvedBy?: string | null; publishedBy?: string | null; status?: string } = {}
): CanonicalPackage {
  return {
    apiVersion: 'optic.uscis/v1',
    kind: 'DefinitionRelease',
    metadata: {
      definitionKey: release.definitionKey,
      displayName: release.displayName,
      entityType: release.entityType,
      version: release.version,
      status: extras.status ?? release.lifecycleStatus,
      approvedBy: extras.approvedBy ?? release.approvedBy ?? null,
      publishedBy: extras.publishedBy ?? release.publishedBy ?? null,
      checksumAlgorithm: 'SHA-256'
    },
    spec: {
      schema: release.schema,
      workflow: release.workflow,
      forms: release.forms,
      actions: release.actions,
      queues: release.queues,
      bulkActions: release.bulkActions,
      scheduledActions: release.scheduledActions,
      slas: release.slas,
      search: release.search
    }
  };
}

export function checksumCanonicalPackage(pkg: CanonicalPackage): {
  algorithm: 'SHA-256';
  checksum: string;
  canonicalJson: string;
} {
  const canonicalJson = stableStringify(pkg);
  return {
    algorithm: 'SHA-256',
    checksum: createHash('sha256').update(canonicalJson).digest('hex'),
    canonicalJson
  };
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`).join(',')}}`;
}
