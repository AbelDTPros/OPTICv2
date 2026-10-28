import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { withTransaction } from '../db/transaction.js';
import type { QueryExecutor } from '../db/types.js';
import { auditPartitionKey, canonicalAudit, computeEventHash } from './hash-chain.js';
import type {
  AppendAuditEventInput,
  AuditActorOption,
  AuditEventRecord,
  AuditEventRepository,
  AuditFilterOptions,
  AuditListQuery,
  AuditListResult
} from './audit-event.repository.js';

interface AuditRow extends RowDataPacket {
  id: number;
  event_id: string;
  event_type: string;
  occurred_at: Date;
  actor_id: string | null;
  actor_name: string | null;
  session_id: string | null;
  correlation_id: string;
  source_service: string;
  entity_type: string | null;
  entity_tracking_id: string | null;
  definition_key: string | null;
  definition_version: string | null;
  stage_key: string | null;
  action_key: string | null;
  event_data_json: unknown;
  previous_hash: string | null;
  event_hash: string | null;
  created_at: Date;
}

const AUDIT_SELECT = `SELECT id, event_id, event_type, occurred_at, actor_id, actor_name, session_id,
              correlation_id, source_service, entity_type, entity_tracking_id, definition_key,
              definition_version, stage_key, action_key, event_data_json, previous_hash, event_hash, created_at
         FROM audit_event`;

export class MysqlAuditEventRepository implements AuditEventRepository {
  constructor(private readonly pool: Pool) {}

  async append(input: AppendAuditEventInput, executor?: QueryExecutor): Promise<AuditEventRecord> {
    if (executor) {
      return this.appendOn(executor, input);
    }
    return withTransaction(this.pool, (connection) => this.appendOn(connection, input));
  }

  async findByEventId(eventId: string, executor?: QueryExecutor): Promise<AuditEventRecord | null> {
    const [rows] = await this.executor(executor).execute<AuditRow[]>(
      `${AUDIT_SELECT}
        WHERE event_id = ?`,
      [eventId]
    );
    return rows[0] ? mapAudit(rows[0]) : null;
  }

  async listByEntity(
    entityType: string,
    entityTrackingId: string,
    executor?: QueryExecutor
  ): Promise<AuditEventRecord[]> {
    const [rows] = await this.executor(executor).execute<AuditRow[]>(
      `${AUDIT_SELECT}
        WHERE entity_type = ? AND entity_tracking_id = ?
        ORDER BY id`,
      [entityType, entityTrackingId]
    );
    return rows.map(mapAudit);
  }

  async listByCorrelationId(correlationId: string, executor?: QueryExecutor): Promise<AuditEventRecord[]> {
    const [rows] = await this.executor(executor).execute<AuditRow[]>(
      `${AUDIT_SELECT}
        WHERE correlation_id = ?
        ORDER BY id`,
      [correlationId]
    );
    return rows.map(mapAudit);
  }

  async listAdmin(query: AuditListQuery, executor?: QueryExecutor): Promise<AuditListResult> {
    const includeEventData = query.includeEventData !== false;
    // mysql2 prepared statements reject bound LIMIT/OFFSET on this server; interpolate bounded ints.
    const pageSize = Math.max(1, Math.min(100, Math.trunc(Number(query.limit)) || 25));
    const page = Math.max(1, Math.trunc(Number(query.page)) || 1);
    const offset = (page - 1) * pageSize;
    const { where, params } = buildAdminFilters(query);
    const client = this.executor(executor);
    const [countRows] = await client.execute<Array<RowDataPacket & { total: number }>>(
      `SELECT COUNT(*) AS total FROM audit_event ${where}`,
      params
    );
    const total = Number(countRows[0]?.total ?? 0);
    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
    const [rows] = await client.execute<AuditRow[]>(
      `${AUDIT_SELECT}
        ${where}
        ORDER BY id DESC
        LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );
    const items = rows.map((row) => {
      const mapped = mapAudit(row);
      if (!includeEventData) {
        mapped.eventData = {};
      }
      return mapped;
    });
    return { items, page, pageSize, total, totalPages };
  }

  async listRecentForDefinitions(
    definitionKeys: string[],
    eventTypes: string[],
    limit: number,
    executor?: QueryExecutor
  ): Promise<AuditEventRecord[]> {
    const keys = [...new Set(definitionKeys.map((key) => key.trim()).filter(Boolean))];
    const types = [...new Set(eventTypes.map((type) => type.trim()).filter(Boolean))];
    const capped = Math.max(1, Math.min(50, Math.trunc(Number(limit)) || 15));
    if (keys.length === 0 || types.length === 0) {
      return [];
    }
    const keyPlaceholders = keys.map(() => '?').join(', ');
    const typePlaceholders = types.map(() => '?').join(', ');
    const [rows] = await this.executor(executor).execute<AuditRow[]>(
      `${AUDIT_SELECT}
        WHERE definition_key IN (${keyPlaceholders})
          AND event_type IN (${typePlaceholders})
        ORDER BY id DESC
        LIMIT ${capped}`,
      [...keys, ...types]
    );
    return rows.map(mapAudit);
  }

  async listAdminFilterOptions(executor?: QueryExecutor): Promise<AuditFilterOptions> {
    const client = this.executor(executor);
    const [actorRows] = await client.execute<
      Array<RowDataPacket & { actor_id: string | null; actor_name: string | null }>
    >(
      `SELECT actor_id, actor_name
         FROM audit_event
        WHERE COALESCE(NULLIF(TRIM(actor_id), ''), NULLIF(TRIM(actor_name), '')) IS NOT NULL
        GROUP BY actor_id, actor_name
        ORDER BY COALESCE(NULLIF(TRIM(actor_name), ''), actor_id)
        LIMIT 500`
    );
    const actorsByValue = new Map<string, AuditActorOption>();
    for (const row of actorRows) {
      const id = (row.actor_id ?? '').trim();
      const name = (row.actor_name ?? '').trim();
      const value = id || name;
      if (!value || actorsByValue.has(value)) {
        continue;
      }
      const label = name && id && name.toLowerCase() !== id.toLowerCase() ? `${name} (${id})` : name || id;
      actorsByValue.set(value, { value, label });
    }

    const [definitionRows] = await client.execute<Array<RowDataPacket & { definition_key: string }>>(
      `SELECT DISTINCT definition_key
         FROM audit_event
        WHERE definition_key IS NOT NULL AND TRIM(definition_key) <> ''
        ORDER BY definition_key
        LIMIT 500`
    );

    return {
      actors: [...actorsByValue.values()],
      definitionKeys: definitionRows.map((row) => row.definition_key)
    };
  }

  private async appendOn(executor: QueryExecutor, input: AppendAuditEventInput): Promise<AuditEventRecord> {
    const existing = await this.findByEventId(input.eventId, executor);
    if (existing) {
      return existing;
    }

    const partition = auditPartitionKey(input);
    await executor.execute(
      `INSERT INTO audit_hash_cursor (partition_key, last_event_id, last_event_hash, updated_at)
       VALUES (?, NULL, NULL, UTC_TIMESTAMP(6))
       ON DUPLICATE KEY UPDATE partition_key = partition_key`,
      [partition]
    );
    const [cursors] = await executor.execute<Array<RowDataPacket & { last_event_hash: string | null }>>(
      `SELECT last_event_hash
         FROM audit_hash_cursor
        WHERE partition_key = ?
        FOR UPDATE`,
      [partition]
    );
    const previousHash = cursors[0]?.last_event_hash ?? null;
    const eventHash = computeEventHash(canonicalAudit(input), previousHash);

    try {
      await executor.execute<ResultSetHeader>(
        `INSERT INTO audit_event
          (event_id, event_type, occurred_at, actor_id, actor_name, session_id, correlation_id,
           source_service, entity_type, entity_tracking_id, definition_key, definition_version,
           stage_key, action_key, event_data_json, previous_hash, event_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, UTC_TIMESTAMP(6))`,
        [
          input.eventId,
          input.eventType,
          toMysqlDate(input.occurredAt),
          input.actorId,
          input.actorName,
          input.sessionId,
          input.correlationId,
          input.sourceService,
          input.entityType,
          input.entityTrackingId,
          input.definitionKey,
          input.definitionVersion,
          input.stageKey,
          input.actionKey,
          JSON.stringify(input.eventData),
          previousHash,
          eventHash
        ]
      );
    } catch (error: unknown) {
      if (isDuplicate(error)) {
        const duplicate = await this.findByEventId(input.eventId, executor);
        if (duplicate) {
          return duplicate;
        }
      }
      throw error;
    }

    await executor.execute(
      `UPDATE audit_hash_cursor
          SET last_event_id = ?,
              last_event_hash = ?,
              updated_at = UTC_TIMESTAMP(6)
        WHERE partition_key = ?`,
      [input.eventId, eventHash, partition]
    );

    const inserted = await this.findByEventId(input.eventId, executor);
    if (!inserted) {
      throw new Error('Audit insert succeeded but row was not readable.');
    }
    return inserted;
  }

  private executor(executor?: QueryExecutor): QueryExecutor {
    return executor ?? this.pool;
  }
}

function buildAdminFilters(query: AuditListQuery): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (query.eventType) {
    // Dropdown values stay exact; free-text fields below use contains.
    clauses.push('event_type = ?');
    params.push(query.eventType);
  }
  if (query.actorId) {
    clauses.push('(actor_id LIKE ? OR actor_name LIKE ?)');
    const pattern = likeContains(query.actorId);
    params.push(pattern, pattern);
  }
  if (query.entityType) {
    clauses.push('entity_type LIKE ?');
    params.push(likeContains(query.entityType));
  }
  if (query.entityTrackingId) {
    clauses.push('entity_tracking_id LIKE ?');
    params.push(likeContains(query.entityTrackingId));
  }
  if (query.definitionKey) {
    clauses.push('definition_key LIKE ?');
    params.push(likeContains(query.definitionKey));
  }
  if (query.correlationId) {
    clauses.push('correlation_id LIKE ?');
    params.push(likeContains(query.correlationId));
  }
  if (query.from) {
    clauses.push('occurred_at >= ?');
    params.push(toMysqlDate(query.from));
  }
  if (query.to) {
    clauses.push('occurred_at <= ?');
    params.push(toMysqlDate(query.to));
  }
  return {
    where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params
  };
}

/** Case-insensitive contains pattern for MySQL LIKE (utf8mb4_unicode_ci). */
function likeContains(value: string): string {
  return `%${escapeLike(value.trim())}%`;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function mapAudit(row: AuditRow): AuditEventRecord {
  return {
    id: Number(row.id),
    eventId: row.event_id,
    eventType: row.event_type,
    occurredAt: row.occurred_at instanceof Date ? row.occurred_at : new Date(row.occurred_at),
    actorId: row.actor_id,
    actorName: row.actor_name,
    sessionId: row.session_id,
    correlationId: row.correlation_id,
    sourceService: row.source_service,
    entityType: row.entity_type,
    entityTrackingId: row.entity_tracking_id,
    definitionKey: row.definition_key,
    definitionVersion: row.definition_version,
    stageKey: row.stage_key,
    actionKey: row.action_key,
    eventData: parseJsonObject(row.event_data_json),
    previousHash: row.previous_hash,
    eventHash: row.event_hash ?? '',
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at)
  };
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toMysqlDate(value: Date): string {
  return value.toISOString().slice(0, 23).replace('T', ' ');
}

function isDuplicate(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'ER_DUP_ENTRY'
  );
}
