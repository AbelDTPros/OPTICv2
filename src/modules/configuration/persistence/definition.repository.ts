import type { QueryExecutor } from '../../../platform/db/types.js';
import type {
  DefinitionLifecycle,
  DefinitionRecord,
  DefinitionReleaseRecord,
  EntityType,
  ReleaseCatalogItem
} from '../domain/types.js';

export type DefinitionChildKind =
  | 'stage'
  | 'transition'
  | 'form'
  | 'action'
  | 'queue'
  | 'bulkAction'
  | 'scheduledAction'
  | 'sla'
  | 'search';

export interface DefinitionChildRecord {
  id: number;
  definitionReleaseId: number;
  stableKey: string;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  rowVersion: number;
}

export interface CreateDefinitionInput {
  definitionKey: string;
  displayName: string;
  entityType: EntityType;
  createdBy: string;
}

export interface CreateReleaseInput {
  definitionId: number;
  definitionKey: string;
  displayName: string;
  entityType: EntityType;
  version: string;
  manifest: Record<string, unknown>;
  createdBy: string;
  lifecycleStatus?: DefinitionLifecycle;
  canonicalPackage?: Record<string, unknown> | null;
  checksumAlgorithm?: string | null;
  checksum?: string | null;
  submittedBy?: string | null;
  approvedBy?: string | null;
  publishedBy?: string | null;
}

export interface UpdateLifecycleInput {
  releaseId: number;
  expectedRowVersion: number;
  expectedStatus: DefinitionLifecycle;
  lifecycleStatus: DefinitionLifecycle;
  manifest: Record<string, unknown>;
  submittedBy?: string | null;
  approvedBy?: string | null;
  publishedBy?: string | null;
  canonicalPackage?: Record<string, unknown> | null;
  checksumAlgorithm?: string | null;
  checksum?: string | null;
  setRetired?: boolean;
  clearRetired?: boolean;
}

export interface DefinitionRepository {
  createDefinition(input: CreateDefinitionInput, executor?: QueryExecutor): Promise<DefinitionRecord>;
  findDefinitionByKey(definitionKey: string, executor?: QueryExecutor): Promise<DefinitionRecord | null>;
  listDefinitions(): Promise<DefinitionRecord[]>;
  listReleaseCatalog(): Promise<ReleaseCatalogItem[]>;
  createRelease(input: CreateReleaseInput, executor?: QueryExecutor): Promise<DefinitionReleaseRecord>;
  findReleaseByKeyAndVersion(
    definitionKey: string,
    version: string,
    executor?: QueryExecutor
  ): Promise<DefinitionReleaseRecord | null>;
  findReleaseById(id: number, executor?: QueryExecutor): Promise<DefinitionReleaseRecord | null>;
  updateReleaseManifest(
    releaseId: number,
    expectedRowVersion: number,
    manifest: Record<string, unknown>,
    executor?: QueryExecutor
  ): Promise<DefinitionReleaseRecord>;
  updateLifecycle(input: UpdateLifecycleInput, executor?: QueryExecutor): Promise<DefinitionReleaseRecord>;
  setActiveRelease(definitionId: number, releaseId: number | null, executor?: QueryExecutor): Promise<void>;
  countReleasesForDefinition(definitionId: number, executor?: QueryExecutor): Promise<number>;
  deleteRelease(releaseId: number, expectedRowVersion: number, executor?: QueryExecutor): Promise<void>;
  deleteDefinition(definitionId: number, executor?: QueryExecutor): Promise<void>;
  /** Removes Try/live cases pinned to this release so its stages and forms can be deleted. */
  purgeRuntimeForRelease(releaseId: number, executor?: QueryExecutor): Promise<void>;
  listChildren(
    releaseId: number,
    kind: DefinitionChildKind,
    executor?: QueryExecutor
  ): Promise<DefinitionChildRecord[]>;
  replaceChildren(
    releaseId: number,
    kind: DefinitionChildKind,
    children: Array<{ stableKey: string; config: Record<string, unknown> }>,
    executor?: QueryExecutor
  ): Promise<void>;
  upsertChild(
    releaseId: number,
    kind: DefinitionChildKind,
    stableKey: string,
    config: Record<string, unknown>,
    executor?: QueryExecutor
  ): Promise<DefinitionChildRecord>;
  deleteChild(
    releaseId: number,
    kind: DefinitionChildKind,
    stableKey: string,
    executor?: QueryExecutor
  ): Promise<void>;
}
