import { conflict, notFound } from '../../../platform/errors/app-error.js';
import type { DefinitionLifecycle, ReleaseCatalogItem } from '../domain/types.js';
import type {
  CreateDefinitionInput,
  CreateReleaseInput,
  DefinitionChildKind,
  DefinitionChildRecord,
  DefinitionRepository,
  UpdateLifecycleInput
} from './definition.repository.js';
import type { DefinitionRecord, DefinitionReleaseRecord } from '../domain/types.js';
import { ALL_CHILD_KINDS } from './child-table-map.js';

interface StoredRelease extends DefinitionReleaseRecord {
  children: Record<DefinitionChildKind, DefinitionChildRecord[]>;
}

export class InMemoryDefinitionRepository implements DefinitionRepository {
  private definitionId = 1;
  private releaseId = 1;
  private childId = 1;
  private readonly definitions = new Map<string, DefinitionRecord>();
  private readonly releases = new Map<number, StoredRelease>();

  async createDefinition(input: CreateDefinitionInput): Promise<DefinitionRecord> {
    if (this.definitions.has(input.definitionKey)) {
      throw conflict('OPTIC-CONFIG-40901', `Definition ${input.definitionKey} already exists.`);
    }
    const record: DefinitionRecord = {
      id: this.definitionId++,
      definitionKey: input.definitionKey,
      displayName: input.displayName,
      entityType: input.entityType,
      activeReleaseId: null,
      createdAt: new Date(),
      createdBy: input.createdBy
    };
    this.definitions.set(record.definitionKey, record);
    return { ...record };
  }

  async findDefinitionByKey(definitionKey: string, _executor?: unknown): Promise<DefinitionRecord | null> {
    const record = this.definitions.get(definitionKey);
    return record ? { ...record } : null;
  }

  async listDefinitions(): Promise<DefinitionRecord[]> {
    return [...this.definitions.values()].map((record) => ({ ...record }));
  }

  async listReleaseCatalog(): Promise<ReleaseCatalogItem[]> {
    const byId = new Map([...this.definitions.values()].map((record) => [record.id, record]));
    return [...this.releases.values()]
      .map((release) => {
        const definition = byId.get(release.definitionId);
        return {
          definitionKey: release.definitionKey,
          displayName: definition?.displayName ?? release.displayName,
          entityType: definition?.entityType ?? release.entityType,
          version: release.version,
          lifecycleStatus: release.lifecycleStatus,
          active: definition?.activeReleaseId === release.id
        };
      })
      .sort(
        (left, right) =>
          left.definitionKey.localeCompare(right.definitionKey) || left.version.localeCompare(right.version)
      );
  }

  async createRelease(input: CreateReleaseInput): Promise<DefinitionReleaseRecord> {
    const existing = [...this.releases.values()].find(
      (release) => release.definitionId === input.definitionId && release.version === input.version
    );
    if (existing) {
      throw conflict(
        'OPTIC-CONFIG-40901',
        `Release ${input.definitionKey} ${input.version} already exists.`
      );
    }

    const now = new Date();
    const lifecycleStatus = input.lifecycleStatus ?? 'DRAFT';
    const record: StoredRelease = {
      id: this.releaseId++,
      definitionId: input.definitionId,
      definitionKey: input.definitionKey,
      displayName: input.displayName,
      entityType: input.entityType,
      version: input.version,
      lifecycleStatus,
      manifest: structuredClone(input.manifest),
      canonicalPackage: input.canonicalPackage ? structuredClone(input.canonicalPackage) : null,
      checksumAlgorithm: input.checksumAlgorithm ?? null,
      checksum: input.checksum ?? null,
      createdAt: now,
      createdBy: input.createdBy,
      submittedAt: input.submittedBy ? now : null,
      submittedBy: input.submittedBy ?? null,
      approvedAt: input.approvedBy ? now : null,
      approvedBy: input.approvedBy ?? null,
      publishedAt: input.publishedBy || lifecycleStatus === 'PUBLISHED' ? now : null,
      publishedBy: input.publishedBy ?? null,
      retiredAt: null,
      rowVersion: 0,
      children: emptyChildren()
    };
    this.releases.set(record.id, record);
    return publicRelease(record);
  }

  async findReleaseByKeyAndVersion(
    definitionKey: string,
    version: string
  ): Promise<DefinitionReleaseRecord | null> {
    const record = [...this.releases.values()].find(
      (release) => release.definitionKey === definitionKey && release.version === version
    );
    return record ? publicRelease(record) : null;
  }

  async findReleaseById(id: number): Promise<DefinitionReleaseRecord | null> {
    const record = this.releases.get(id);
    return record ? publicRelease(record) : null;
  }

  async updateReleaseManifest(
    releaseId: number,
    expectedRowVersion: number,
    manifest: Record<string, unknown>
  ): Promise<DefinitionReleaseRecord> {
    const record = this.releases.get(releaseId);
    if (!record) {
      throw notFound('OPTIC-CONFIG-40402', 'Definition release was not found.');
    }
    if (record.rowVersion !== expectedRowVersion) {
      throw conflict('OPTIC-WF-40901', 'This item changed after you opened it. Refresh and try again.');
    }
    record.manifest = structuredClone(manifest);
    record.rowVersion += 1;
    return publicRelease(record);
  }

  async updateLifecycle(input: UpdateLifecycleInput): Promise<DefinitionReleaseRecord> {
    const record = this.releases.get(input.releaseId);
    if (!record) {
      throw notFound('OPTIC-CONFIG-40402', 'Definition release was not found.');
    }
    if (record.rowVersion !== input.expectedRowVersion || record.lifecycleStatus !== input.expectedStatus) {
      throw conflict('OPTIC-WF-40901', 'This item changed after you opened it. Refresh and try again.');
    }
    const now = new Date();
    record.lifecycleStatus = input.lifecycleStatus;
    record.manifest = structuredClone(input.manifest);
    if (input.submittedBy !== undefined) {
      record.submittedBy = input.submittedBy;
      record.submittedAt = input.submittedBy ? now : null;
    }
    if (input.approvedBy !== undefined) {
      record.approvedBy = input.approvedBy;
      record.approvedAt = input.approvedBy ? now : null;
    }
    if (input.publishedBy !== undefined) {
      record.publishedBy = input.publishedBy;
      record.publishedAt = input.publishedBy ? now : null;
    }
    if (input.canonicalPackage !== undefined) {
      record.canonicalPackage = input.canonicalPackage ? structuredClone(input.canonicalPackage) : null;
    }
    if (input.checksum !== undefined) {
      record.checksum = input.checksum;
      record.checksumAlgorithm = input.checksumAlgorithm ?? null;
    }
    if (input.setRetired) {
      record.retiredAt = now;
    }
    if (input.clearRetired) {
      record.retiredAt = null;
    }
    record.rowVersion += 1;
    return publicRelease(record);
  }

  async setActiveRelease(definitionId: number, releaseId: number | null): Promise<void> {
    const definition = [...this.definitions.values()].find((item) => item.id === definitionId);
    if (!definition) {
      throw notFound('OPTIC-CONFIG-40401', `Definition ${definitionId} was not found.`);
    }
    definition.activeReleaseId = releaseId;
  }

  async countReleasesForDefinition(definitionId: number): Promise<number> {
    return [...this.releases.values()].filter((release) => release.definitionId === definitionId).length;
  }

  async deleteRelease(releaseId: number, expectedRowVersion: number): Promise<void> {
    const record = this.releases.get(releaseId);
    if (!record) {
      throw notFound('OPTIC-CONFIG-40402', 'Definition release was not found.');
    }
    if (record.lifecycleStatus !== 'DRAFT') {
      throw conflict(
        'OPTIC-CONFIG-40908',
        `Only a DRAFT release can be deleted. This release is ${record.lifecycleStatus}.`
      );
    }
    if (record.rowVersion !== expectedRowVersion) {
      throw conflict('OPTIC-WF-40901', 'This item changed after you opened it. Refresh and try again.');
    }
    this.releases.delete(releaseId);
  }

  async purgeRuntimeForRelease(_releaseId: number): Promise<void> {
    return;
  }

  async deleteDefinition(definitionId: number): Promise<void> {
    for (const [key, record] of this.definitions) {
      if (record.id === definitionId) {
        this.definitions.delete(key);
        return;
      }
    }
    throw notFound('OPTIC-CONFIG-40401', `Definition ${definitionId} was not found.`);
  }

  async listChildren(releaseId: number, kind: DefinitionChildKind): Promise<DefinitionChildRecord[]> {
    const record = this.requireRelease(releaseId);
    return record.children[kind].map((child) => structuredClone(child));
  }

  async replaceChildren(
    releaseId: number,
    kind: DefinitionChildKind,
    children: Array<{ stableKey: string; config: Record<string, unknown> }>
  ): Promise<void> {
    const record = this.requireRelease(releaseId);
    const now = new Date();
    const existing = new Map(record.children[kind].map((child) => [child.stableKey, child]));
    record.children[kind] = children.map((child) => {
      const current = existing.get(child.stableKey);
      if (current) {
        return {
          ...current,
          config: structuredClone(child.config),
          updatedAt: now,
          rowVersion: current.rowVersion + 1
        };
      }
      return {
        id: this.childId++,
        definitionReleaseId: releaseId,
        stableKey: child.stableKey,
        config: structuredClone(child.config),
        createdAt: now,
        updatedAt: now,
        rowVersion: 0
      };
    });
  }

  async upsertChild(
    releaseId: number,
    kind: DefinitionChildKind,
    stableKey: string,
    config: Record<string, unknown>
  ): Promise<DefinitionChildRecord> {
    const record = this.requireRelease(releaseId);
    const existing = record.children[kind].find((child) => child.stableKey === stableKey);
    const now = new Date();
    if (existing) {
      existing.config = structuredClone(config);
      existing.updatedAt = now;
      existing.rowVersion += 1;
      return structuredClone(existing);
    }
    const created: DefinitionChildRecord = {
      id: this.childId++,
      definitionReleaseId: releaseId,
      stableKey,
      config: structuredClone(config),
      createdAt: now,
      updatedAt: now,
      rowVersion: 0
    };
    record.children[kind].push(created);
    return structuredClone(created);
  }

  async deleteChild(releaseId: number, kind: DefinitionChildKind, stableKey: string): Promise<void> {
    const record = this.requireRelease(releaseId);
    const next = record.children[kind].filter((child) => child.stableKey !== stableKey);
    if (next.length === record.children[kind].length) {
      throw notFound('OPTIC-CONFIG-40403', `${kind} ${stableKey} was not found.`);
    }
    record.children[kind] = next;
  }

  setLifecycleForTest(definitionKey: string, version: string, status: DefinitionLifecycle): void {
    const record = [...this.releases.values()].find(
      (release) => release.definitionKey === definitionKey && release.version === version
    );
    if (record) {
      record.lifecycleStatus = status;
    }
  }

  setActiveReleaseForTest(definitionKey: string, version: string): void {
    const definition = this.definitions.get(definitionKey);
    const release = [...this.releases.values()].find(
      (row) => row.definitionKey === definitionKey && row.version === version
    );
    if (definition && release) {
      definition.activeReleaseId = release.id;
    }
  }

  private requireRelease(releaseId: number): StoredRelease {
    const record = this.releases.get(releaseId);
    if (!record) {
      throw notFound('OPTIC-CONFIG-40402', 'Definition release was not found.');
    }
    return record;
  }
}

function emptyChildren(): Record<DefinitionChildKind, DefinitionChildRecord[]> {
  return Object.fromEntries(ALL_CHILD_KINDS.map((kind) => [kind, []])) as unknown as Record<
    DefinitionChildKind,
    DefinitionChildRecord[]
  >;
}

function publicRelease(record: StoredRelease): DefinitionReleaseRecord {
  const { children: _children, ...release } = record;
  return {
    ...release,
    manifest: structuredClone(record.manifest)
  };
}
