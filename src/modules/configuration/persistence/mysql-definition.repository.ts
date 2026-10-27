import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { conflict, notFound } from '../../../platform/errors/app-error.js';
import type { QueryExecutor } from '../../../platform/db/types.js';
import type {
  DefinitionLifecycle,
  DefinitionRecord,
  DefinitionReleaseRecord,
  ReleaseCatalogItem
} from '../domain/types.js';
import { CHILD_TABLES } from './child-table-map.js';
import type {
  CreateDefinitionInput,
  CreateReleaseInput,
  DefinitionChildKind,
  DefinitionChildRecord,
  DefinitionRepository,
  UpdateLifecycleInput
} from './definition.repository.js';

interface DefinitionRow extends RowDataPacket {
  id: number;
  definition_key: string;
  display_name: string;
  entity_type: string;
  active_release_id: number | null;
  created_at: Date;
  created_by: string;
}

interface ReleaseRow extends RowDataPacket {
  id: number;
  definition_id: number;
  definition_key: string;
  display_name: string;
  entity_type: string;
  version: string;
  lifecycle_status: DefinitionLifecycle;
  manifest_json: unknown;
  canonical_package_json: unknown;
  checksum_algorithm: string | null;
  checksum: string | null;
  created_at: Date;
  created_by: string;
  submitted_at: Date | null;
  submitted_by: string | null;
  approved_at: Date | null;
  approved_by: string | null;
  published_at: Date | null;
  published_by: string | null;
  retired_at: Date | null;
  row_version: number;
}

interface CatalogRow extends RowDataPacket {
  definition_key: string;
  display_name: string;
  entity_type: string;
  version: string;
  lifecycle_status: DefinitionLifecycle;
  active: number | boolean;
}

interface CountRow extends RowDataPacket {
  release_count: number;
}

interface ChildRow extends RowDataPacket {
  id: number;
  definition_release_id: number;
  stable_key: string;
  config_json: unknown;
  created_at: Date;
  updated_at: Date;
  row_version: number;
}

export class MysqlDefinitionRepository implements DefinitionRepository {
  constructor(private readonly pool: Pool) {}

  async createDefinition(input: CreateDefinitionInput, executor?: QueryExecutor): Promise<DefinitionRecord> {
    try {
      const [result] = await this.executor(executor).execute<ResultSetHeader>(
        `INSERT INTO definition
          (definition_key, display_name, entity_type, created_at, created_by)
         VALUES (?, ?, ?, UTC_TIMESTAMP(6), ?)`,
        [input.definitionKey, input.displayName, input.entityType, input.createdBy]
      );
      const created = await this.findDefinitionById(result.insertId, executor);
      if (!created) {
        throw new Error('Definition insert succeeded but row was not readable.');
      }
      return created;
    } catch (error) {
      throw translateDuplicate(error, `Definition ${input.definitionKey} already exists.`);
    }
  }

  async findDefinitionByKey(definitionKey: string, executor?: QueryExecutor): Promise<DefinitionRecord | null> {
    const [rows] = await this.executor(executor).execute<DefinitionRow[]>(
      `SELECT id, definition_key, display_name, entity_type, active_release_id, created_at, created_by
         FROM definition
        WHERE definition_key = ?`,
      [definitionKey]
    );
    return rows[0] ? mapDefinition(rows[0]) : null;
  }

  async listDefinitions(): Promise<DefinitionRecord[]> {
    const [rows] = await this.executor().execute<DefinitionRow[]>(
      `SELECT id, definition_key, display_name, entity_type, active_release_id, created_at, created_by
         FROM definition
        ORDER BY definition_key`
    );
    return rows.map(mapDefinition);
  }

  async listReleaseCatalog(): Promise<ReleaseCatalogItem[]> {
    const [rows] = await this.executor().execute<CatalogRow[]>(
      `SELECT d.definition_key, d.display_name, d.entity_type, r.version, r.lifecycle_status,
              (d.active_release_id IS NOT NULL AND d.active_release_id = r.id) AS active
         FROM definition_release r
         INNER JOIN definition d ON d.id = r.definition_id
        ORDER BY d.definition_key, r.version`
    );
    return rows.map((row) => ({
      definitionKey: row.definition_key,
      displayName: row.display_name,
      entityType: row.entity_type,
      version: row.version,
      lifecycleStatus: row.lifecycle_status,
      active: row.active === true || Number(row.active) === 1
    }));
  }

  async createRelease(input: CreateReleaseInput, executor?: QueryExecutor): Promise<DefinitionReleaseRecord> {
    try {
      const lifecycleStatus = input.lifecycleStatus ?? 'DRAFT';
      const publishedBy = input.publishedBy ?? null;
      const setPublishedAt = Boolean(publishedBy) || lifecycleStatus === 'PUBLISHED';
      const [result] = await this.executor(executor).execute<ResultSetHeader>(
        `INSERT INTO definition_release
          (definition_id, version, lifecycle_status, manifest_json, canonical_package_json,
           checksum_algorithm, checksum, created_at, created_by, submitted_at, submitted_by,
           approved_at, approved_by, published_at, published_by, row_version)
         VALUES (
           ?, ?, ?, CAST(? AS JSON),
           CASE WHEN ? IS NULL THEN NULL ELSE CAST(? AS JSON) END,
           ?, ?, UTC_TIMESTAMP(6), ?,
           CASE WHEN ? IS NULL THEN NULL ELSE UTC_TIMESTAMP(6) END, ?,
           CASE WHEN ? IS NULL THEN NULL ELSE UTC_TIMESTAMP(6) END, ?,
           CASE WHEN ? = 1 THEN UTC_TIMESTAMP(6) ELSE NULL END, ?,
           0
         )`,
        [
          input.definitionId,
          input.version,
          lifecycleStatus,
          JSON.stringify(input.manifest),
          input.canonicalPackage ? JSON.stringify(input.canonicalPackage) : null,
          input.canonicalPackage ? JSON.stringify(input.canonicalPackage) : null,
          input.checksumAlgorithm ?? null,
          input.checksum ?? null,
          input.createdBy,
          input.submittedBy ?? null,
          input.submittedBy ?? null,
          input.approvedBy ?? null,
          input.approvedBy ?? null,
          setPublishedAt ? 1 : 0,
          publishedBy
        ]
      );
      const created = await this.findReleaseById(result.insertId, executor);
      if (!created) {
        throw new Error('Release insert succeeded but row was not readable.');
      }
      return created;
    } catch (error) {
      throw translateDuplicate(error, `Release ${input.definitionKey} ${input.version} already exists.`);
    }
  }

  async findReleaseByKeyAndVersion(
    definitionKey: string,
    version: string,
    executor?: QueryExecutor
  ): Promise<DefinitionReleaseRecord | null> {
    const [rows] = await this.executor(executor).execute<ReleaseRow[]>(
      `SELECT r.id, r.definition_id, d.definition_key, d.display_name, d.entity_type, r.version,
              r.lifecycle_status, r.manifest_json, r.canonical_package_json, r.checksum_algorithm,
              r.checksum, r.created_at, r.created_by, r.submitted_at, r.submitted_by, r.approved_at,
              r.approved_by, r.published_at, r.published_by, r.retired_at, r.row_version
         FROM definition_release r
         INNER JOIN definition d ON d.id = r.definition_id
        WHERE d.definition_key = ? AND r.version = ?`,
      [definitionKey, version]
    );
    return rows[0] ? mapRelease(rows[0]) : null;
  }

  async updateReleaseManifest(
    releaseId: number,
    expectedRowVersion: number,
    manifest: Record<string, unknown>,
    executor?: QueryExecutor
  ): Promise<DefinitionReleaseRecord> {
    const [result] = await this.executor(executor).execute<ResultSetHeader>(
      `UPDATE definition_release
          SET manifest_json = CAST(? AS JSON),
              row_version = row_version + 1
        WHERE id = ? AND row_version = ?`,
      [JSON.stringify(manifest), releaseId, expectedRowVersion]
    );
    if (result.affectedRows === 0) {
      const existing = await this.findReleaseById(releaseId, executor);
      if (!existing) {
        throw notFound('OPTIC-CONFIG-40402', 'Definition release was not found.');
      }
      throw conflict('OPTIC-WF-40901', 'This item changed after you opened it. Refresh and try again.');
    }
    const updated = await this.findReleaseById(releaseId, executor);
    if (!updated) {
      throw notFound('OPTIC-CONFIG-40402', 'Definition release was not found.');
    }
    return updated;
  }

  async updateLifecycle(input: UpdateLifecycleInput, executor?: QueryExecutor): Promise<DefinitionReleaseRecord> {
    const assignments = [
      'lifecycle_status = ?',
      'manifest_json = CAST(? AS JSON)',
      'row_version = row_version + 1'
    ];
    const values: Array<string | number | null> = [input.lifecycleStatus, JSON.stringify(input.manifest)];
    if (input.submittedBy !== undefined) {
      assignments.push('submitted_by = ?', 'submitted_at = IF(? IS NULL, NULL, UTC_TIMESTAMP(6))');
      values.push(input.submittedBy, input.submittedBy);
    }
    if (input.approvedBy !== undefined) {
      assignments.push('approved_by = ?', 'approved_at = IF(? IS NULL, NULL, UTC_TIMESTAMP(6))');
      values.push(input.approvedBy, input.approvedBy);
    }
    if (input.publishedBy !== undefined) {
      assignments.push('published_by = ?', 'published_at = IF(? IS NULL, NULL, UTC_TIMESTAMP(6))');
      values.push(input.publishedBy, input.publishedBy);
    }
    if (input.canonicalPackage) {
      assignments.push('canonical_package_json = CAST(? AS JSON)');
      values.push(JSON.stringify(input.canonicalPackage));
    } else if (input.canonicalPackage === null) {
      assignments.push('canonical_package_json = NULL');
    }
    if (input.checksum !== undefined) {
      assignments.push('checksum = ?', 'checksum_algorithm = ?');
      values.push(input.checksum, input.checksumAlgorithm ?? null);
    }
    if (input.setRetired) {
      assignments.push('retired_at = UTC_TIMESTAMP(6)');
    }
    if (input.clearRetired) {
      assignments.push('retired_at = NULL');
    }
    const [result] = await this.executor(executor).execute<ResultSetHeader>(
      `UPDATE definition_release
          SET ${assignments.join(', ')}
        WHERE id = ? AND row_version = ? AND lifecycle_status = ?`,
      [...values, input.releaseId, input.expectedRowVersion, input.expectedStatus]
    );
    if (result.affectedRows === 0) {
      const existing = await this.findReleaseById(input.releaseId, executor);
      if (!existing) {
        throw notFound('OPTIC-CONFIG-40402', 'Definition release was not found.');
      }
      throw conflict('OPTIC-WF-40901', 'This item changed after you opened it. Refresh and try again.');
    }
    const updated = await this.findReleaseById(input.releaseId, executor);
    if (!updated) {
      throw notFound('OPTIC-CONFIG-40402', 'Definition release was not found.');
    }
    return updated;
  }

  async setActiveRelease(definitionId: number, releaseId: number | null, executor?: QueryExecutor): Promise<void> {
    const [result] = await this.executor(executor).execute<ResultSetHeader>(
      `UPDATE definition SET active_release_id = ? WHERE id = ?`,
      [releaseId, definitionId]
    );
    if (result.affectedRows === 0) {
      throw notFound('OPTIC-CONFIG-40401', `Definition ${definitionId} was not found.`);
    }
  }

  async countReleasesForDefinition(definitionId: number, executor?: QueryExecutor): Promise<number> {
    const [rows] = await this.executor(executor).execute<CountRow[]>(
      `SELECT COUNT(*) AS release_count FROM definition_release WHERE definition_id = ?`,
      [definitionId]
    );
    return Number(rows[0]?.release_count ?? 0);
  }

  async deleteRelease(releaseId: number, expectedRowVersion: number, executor?: QueryExecutor): Promise<void> {
    try {
      const [result] = await this.executor(executor).execute<ResultSetHeader>(
        `DELETE FROM definition_release
          WHERE id = ? AND row_version = ? AND lifecycle_status = 'DRAFT'`,
        [releaseId, expectedRowVersion]
      );
      if (result.affectedRows > 0) {
        return;
      }
    } catch (error) {
      throw translateReferenced(
        error,
        'Cannot delete this release because live cases or other records still reference it.'
      );
    }
    const existing = await this.findReleaseById(releaseId, executor);
    if (!existing) {
      throw notFound('OPTIC-CONFIG-40402', 'Definition release was not found.');
    }
    if (existing.lifecycleStatus !== 'DRAFT') {
      throw conflict(
        'OPTIC-CONFIG-40908',
        `Only a DRAFT release can be deleted. This release is ${existing.lifecycleStatus}.`
      );
    }
    throw conflict('OPTIC-WF-40901', 'This item changed after you opened it. Refresh and try again.');
  }

  async purgeRuntimeForRelease(releaseId: number, executor?: QueryExecutor): Promise<void> {
    const db = this.executor(executor);
    await db.execute(
      `DELETE p FROM workflow_queue_projection p
        INNER JOIN workflow_instance wi ON wi.id = p.workflow_instance_id
       WHERE wi.definition_release_id = ?`,
      [releaseId]
    );
    await db.execute(
      `DELETE t FROM workload_transition t
        INNER JOIN workflow_instance wi ON wi.id = t.workflow_instance_id
       WHERE wi.definition_release_id = ?`,
      [releaseId]
    );
    await db.execute(
      `DELETE s FROM scheduled_workflow_action s
        INNER JOIN workflow_instance wi ON wi.id = s.workflow_instance_id
       WHERE wi.definition_release_id = ?`,
      [releaseId]
    );
    await db.execute(
      `DELETE v FROM workflow_stage_visit v
        INNER JOIN workflow_instance wi ON wi.id = v.workflow_instance_id
       WHERE wi.definition_release_id = ?`,
      [releaseId]
    );
    await db.execute(
      `DELETE i FROM bulk_operation_item i
        INNER JOIN bulk_operation b ON b.id = i.bulk_operation_id
       WHERE b.definition_release_id = ?`,
      [releaseId]
    );
    await db.execute(`DELETE FROM bulk_operation WHERE definition_release_id = ?`, [releaseId]);
    await db.execute(`DELETE FROM workflow_instance WHERE definition_release_id = ?`, [releaseId]);
  }

  async deleteDefinition(definitionId: number, executor?: QueryExecutor): Promise<void> {
    const [result] = await this.executor(executor).execute<ResultSetHeader>(
      `DELETE FROM definition WHERE id = ?`,
      [definitionId]
    );
    if (result.affectedRows === 0) {
      throw notFound('OPTIC-CONFIG-40401', `Definition ${definitionId} was not found.`);
    }
  }

  async listChildren(
    releaseId: number,
    kind: DefinitionChildKind,
    executor?: QueryExecutor
  ): Promise<DefinitionChildRecord[]> {
    const mapping = CHILD_TABLES[kind];
    const [rows] = await this.executor(executor).execute<ChildRow[]>(
      `SELECT id, definition_release_id, ${mapping.keyColumn} AS stable_key, config_json,
              created_at, updated_at, row_version
         FROM ${mapping.table}
        WHERE definition_release_id = ?
        ORDER BY ${mapping.keyColumn}`,
      [releaseId]
    );
    return rows.map(mapChild);
  }

  async replaceChildren(
    releaseId: number,
    kind: DefinitionChildKind,
    children: Array<{ stableKey: string; config: Record<string, unknown> }>,
    executor?: QueryExecutor
  ): Promise<void> {
    const mapping = CHILD_TABLES[kind];
    const db = this.executor(executor);
    const existing = await this.listChildren(releaseId, kind, executor);
    const nextKeys = new Set(children.map((child) => child.stableKey));
    for (const child of existing) {
      if (nextKeys.has(child.stableKey)) {
        continue;
      }
      try {
        await db.execute(`DELETE FROM ${mapping.table} WHERE id = ?`, [child.id]);
      } catch (error) {
        throw translateReferenced(
          error,
          `Cannot remove ${child.stableKey} from this draft because cases still use that ${kind}.`
        );
      }
    }
    for (const child of children) {
      const current = existing.find((item) => item.stableKey === child.stableKey);
      if (current) {
        await db.execute(
          `UPDATE ${mapping.table}
              SET config_json = CAST(? AS JSON),
                  updated_at = UTC_TIMESTAMP(6),
                  row_version = row_version + 1
            WHERE id = ?`,
          [JSON.stringify(child.config), current.id]
        );
        continue;
      }
      await db.execute(
        `INSERT INTO ${mapping.table}
          (definition_release_id, ${mapping.keyColumn}, config_json, created_at, updated_at, row_version)
         VALUES (?, ?, CAST(? AS JSON), UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), 0)`,
        [releaseId, child.stableKey, JSON.stringify(child.config)]
      );
    }
  }

  async upsertChild(
    releaseId: number,
    kind: DefinitionChildKind,
    stableKey: string,
    config: Record<string, unknown>,
    executor?: QueryExecutor
  ): Promise<DefinitionChildRecord> {
    const mapping = CHILD_TABLES[kind];
    await this.executor(executor).execute(
      `INSERT INTO ${mapping.table}
         (definition_release_id, ${mapping.keyColumn}, config_json, created_at, updated_at, row_version)
       VALUES (?, ?, CAST(? AS JSON), UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), 0)
       ON DUPLICATE KEY UPDATE
         config_json = CAST(? AS JSON),
         updated_at = UTC_TIMESTAMP(6),
         row_version = row_version + 1`,
      [releaseId, stableKey, JSON.stringify(config), JSON.stringify(config)]
    );
    const [rows] = await this.executor(executor).execute<ChildRow[]>(
      `SELECT id, definition_release_id, ${mapping.keyColumn} AS stable_key, config_json,
              created_at, updated_at, row_version
         FROM ${mapping.table}
        WHERE definition_release_id = ? AND ${mapping.keyColumn} = ?`,
      [releaseId, stableKey]
    );
    const row = rows[0];
    if (!row) {
      throw notFound('OPTIC-CONFIG-40403', 'Definition child was not found after upsert.');
    }
    return mapChild(row);
  }

  async deleteChild(
    releaseId: number,
    kind: DefinitionChildKind,
    stableKey: string,
    executor?: QueryExecutor
  ): Promise<void> {
    const mapping = CHILD_TABLES[kind];
    const [result] = await this.executor(executor).execute<ResultSetHeader>(
      `DELETE FROM ${mapping.table} WHERE definition_release_id = ? AND ${mapping.keyColumn} = ?`,
      [releaseId, stableKey]
    );
    if (result.affectedRows === 0) {
      throw notFound('OPTIC-CONFIG-40403', `${kind} ${stableKey} was not found.`);
    }
  }

  private async findDefinitionById(id: number, executor?: QueryExecutor): Promise<DefinitionRecord | null> {
    const [rows] = await this.executor(executor).execute<DefinitionRow[]>(
      `SELECT id, definition_key, display_name, entity_type, active_release_id, created_at, created_by
         FROM definition
        WHERE id = ?`,
      [id]
    );
    return rows[0] ? mapDefinition(rows[0]) : null;
  }

  async findReleaseById(id: number, executor?: QueryExecutor): Promise<DefinitionReleaseRecord | null> {
    const [rows] = await this.executor(executor).execute<ReleaseRow[]>(
      `SELECT r.id, r.definition_id, d.definition_key, d.display_name, d.entity_type, r.version,
              r.lifecycle_status, r.manifest_json, r.canonical_package_json, r.checksum_algorithm,
              r.checksum, r.created_at, r.created_by, r.submitted_at, r.submitted_by, r.approved_at,
              r.approved_by, r.published_at, r.published_by, r.retired_at, r.row_version
         FROM definition_release r
         INNER JOIN definition d ON d.id = r.definition_id
        WHERE r.id = ?`,
      [id]
    );
    return rows[0] ? mapRelease(rows[0]) : null;
  }

  private executor(executor?: QueryExecutor): QueryExecutor {
    return executor ?? this.pool;
  }
}

function mapDefinition(row: DefinitionRow): DefinitionRecord {
  return {
    id: row.id,
    definitionKey: row.definition_key,
    displayName: row.display_name,
    entityType: row.entity_type,
    activeReleaseId: row.active_release_id,
    createdAt: toDate(row.created_at),
    createdBy: row.created_by
  };
}

function mapRelease(row: ReleaseRow): DefinitionReleaseRecord {
  return {
    id: row.id,
    definitionId: row.definition_id,
    definitionKey: row.definition_key,
    displayName: row.display_name,
    entityType: row.entity_type,
    version: row.version,
    lifecycleStatus: row.lifecycle_status,
    manifest: parseJson(row.manifest_json),
    canonicalPackage: row.canonical_package_json ? parseJson(row.canonical_package_json) : null,
    checksumAlgorithm: row.checksum_algorithm,
    checksum: row.checksum,
    createdAt: toDate(row.created_at),
    createdBy: row.created_by,
    submittedAt: row.submitted_at ? toDate(row.submitted_at) : null,
    submittedBy: row.submitted_by,
    approvedAt: row.approved_at ? toDate(row.approved_at) : null,
    approvedBy: row.approved_by,
    publishedAt: row.published_at ? toDate(row.published_at) : null,
    publishedBy: row.published_by,
    retiredAt: row.retired_at ? toDate(row.retired_at) : null,
    rowVersion: Number(row.row_version)
  };
}

function mapChild(row: ChildRow): DefinitionChildRecord {
  return {
    id: row.id,
    definitionReleaseId: row.definition_release_id,
    stableKey: row.stable_key,
    config: parseJson(row.config_json),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
    rowVersion: Number(row.row_version)
  };
}

function parseJson(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    return JSON.parse(value) as Record<string, unknown>;
  }
  return (value ?? {}) as Record<string, unknown>;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function translateDuplicate(error: unknown, message: string): never {
  if (isDuplicate(error)) {
    throw conflict('OPTIC-CONFIG-40901', message);
  }
  throw error;
}

function isDuplicate(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY');
}

function translateReferenced(error: unknown, message: string): never {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error.code === 'ER_ROW_IS_REFERENCED' || error.code === 'ER_ROW_IS_REFERENCED_2')
  ) {
    throw conflict('OPTIC-CONFIG-40908', message);
  }
  throw error;
}
