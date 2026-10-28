import type { QueryExecutor } from '../db/types.js';

export interface AuditEventRecord {
  id?: number;
  eventId: string;
  eventType: string;
  occurredAt: Date;
  actorId: string | null;
  actorName: string | null;
  sessionId: string | null;
  correlationId: string;
  sourceService: string;
  entityType: string | null;
  entityTrackingId: string | null;
  definitionKey: string | null;
  definitionVersion: string | null;
  stageKey: string | null;
  actionKey: string | null;
  eventData: Record<string, unknown>;
  previousHash: string | null;
  eventHash: string;
  createdAt: Date;
}

export interface AppendAuditEventInput {
  eventId: string;
  eventType: string;
  occurredAt: Date;
  actorId: string | null;
  actorName: string | null;
  sessionId: string | null;
  correlationId: string;
  sourceService: string;
  entityType: string | null;
  entityTrackingId: string | null;
  definitionKey: string | null;
  definitionVersion: string | null;
  stageKey: string | null;
  actionKey: string | null;
  eventData: Record<string, unknown>;
}

export interface AuditListQuery {
  eventType?: string;
  actorId?: string;
  entityType?: string;
  entityTrackingId?: string;
  definitionKey?: string;
  correlationId?: string;
  from?: Date;
  to?: Date;
  /** 1-based page index. */
  page: number;
  /** Page size (limit). */
  limit: number;
  /** When false, eventData is omitted/empty for lighter list payloads. */
  includeEventData?: boolean;
}

export interface AuditListResult {
  items: AuditEventRecord[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AuditActorOption {
  /** Value sent as the actorId list filter (actor id, or name when id is absent). */
  value: string;
  label: string;
}

export interface AuditFilterOptions {
  actors: AuditActorOption[];
  definitionKeys: string[];
}

export interface AuditEventRepository {
  append(input: AppendAuditEventInput, executor?: QueryExecutor): Promise<AuditEventRecord>;
  findByEventId(eventId: string, executor?: QueryExecutor): Promise<AuditEventRecord | null>;
  listByEntity(
    entityType: string,
    entityTrackingId: string,
    executor?: QueryExecutor
  ): Promise<AuditEventRecord[]>;
  listByCorrelationId(correlationId: string, executor?: QueryExecutor): Promise<AuditEventRecord[]>;
  listAdmin(query: AuditListQuery, executor?: QueryExecutor): Promise<AuditListResult>;
  listAdminFilterOptions(executor?: QueryExecutor): Promise<AuditFilterOptions>;
  listRecentForDefinitions(
    definitionKeys: string[],
    eventTypes: string[],
    limit: number,
    executor?: QueryExecutor
  ): Promise<AuditEventRecord[]>;
}
