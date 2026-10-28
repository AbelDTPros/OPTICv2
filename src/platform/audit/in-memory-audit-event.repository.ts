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

export class InMemoryAuditEventRepository implements AuditEventRepository {
  readonly events: AuditEventRecord[] = [];
  private readonly cursors = new Map<string, { lastEventId: string; lastEventHash: string }>();
  private nextId = 1;

  async append(input: AppendAuditEventInput): Promise<AuditEventRecord> {
    const existing = this.events.find((event) => event.eventId === input.eventId);
    if (existing) {
      return structuredClone(existing);
    }
    const partition = auditPartitionKey(input);
    const previousHash = this.cursors.get(partition)?.lastEventHash ?? null;
    const eventHash = computeEventHash(canonicalAudit(input), previousHash);
    const record: AuditEventRecord = {
      id: this.nextId++,
      ...input,
      eventData: structuredClone(input.eventData),
      previousHash,
      eventHash,
      createdAt: new Date()
    };
    this.events.push(record);
    this.cursors.set(partition, { lastEventId: record.eventId, lastEventHash: eventHash });
    return structuredClone(record);
  }

  async findByEventId(eventId: string): Promise<AuditEventRecord | null> {
    const event = this.events.find((row) => row.eventId === eventId);
    return event ? structuredClone(event) : null;
  }

  async listByEntity(entityType: string, entityTrackingId: string): Promise<AuditEventRecord[]> {
    return this.events
      .filter((event) => event.entityType === entityType && event.entityTrackingId === entityTrackingId)
      .map((event) => structuredClone(event));
  }

  async listByCorrelationId(correlationId: string): Promise<AuditEventRecord[]> {
    return this.events
      .filter((event) => event.correlationId === correlationId)
      .map((event) => structuredClone(event));
  }

  async listAdmin(query: AuditListQuery): Promise<AuditListResult> {
    const includeEventData = query.includeEventData !== false;
    const pageSize = Math.max(1, Math.min(100, Math.trunc(Number(query.limit)) || 25));
    const page = Math.max(1, Math.trunc(Number(query.page)) || 1);
    let rows = [...this.events].sort((left, right) => (right.id ?? 0) - (left.id ?? 0));
    if (query.eventType) {
      rows = rows.filter((event) => event.eventType === query.eventType);
    }
    if (query.actorId) {
      const needle = query.actorId.trim().toLowerCase();
      rows = rows.filter(
        (event) =>
          (event.actorId ?? '').toLowerCase().includes(needle) ||
          (event.actorName ?? '').toLowerCase().includes(needle)
      );
    }
    if (query.entityType) {
      const needle = query.entityType.trim().toLowerCase();
      rows = rows.filter((event) => (event.entityType ?? '').toLowerCase().includes(needle));
    }
    if (query.entityTrackingId) {
      const needle = query.entityTrackingId.trim().toLowerCase();
      rows = rows.filter((event) => (event.entityTrackingId ?? '').toLowerCase().includes(needle));
    }
    if (query.definitionKey) {
      const needle = query.definitionKey.trim().toLowerCase();
      rows = rows.filter((event) => (event.definitionKey ?? '').toLowerCase().includes(needle));
    }
    if (query.correlationId) {
      const needle = query.correlationId.trim().toLowerCase();
      rows = rows.filter((event) => event.correlationId.toLowerCase().includes(needle));
    }
    if (query.from) {
      const from = query.from;
      rows = rows.filter((event) => event.occurredAt.getTime() >= from.getTime());
    }
    if (query.to) {
      const to = query.to;
      rows = rows.filter((event) => event.occurredAt.getTime() <= to.getTime());
    }
    const total = rows.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
    const offset = (page - 1) * pageSize;
    const pageRows = rows.slice(offset, offset + pageSize);
    return {
      items: pageRows.map((event) => {
        const clone = structuredClone(event);
        if (!includeEventData) {
          clone.eventData = {};
        }
        return clone;
      }),
      page,
      pageSize,
      total,
      totalPages
    };
  }

  async listRecentForDefinitions(
    definitionKeys: string[],
    eventTypes: string[],
    limit: number
  ): Promise<AuditEventRecord[]> {
    const keys = new Set(definitionKeys);
    const types = new Set(eventTypes);
    const capped = Math.max(1, Math.min(50, Math.trunc(limit) || 15));
    return [...this.events]
      .filter(
        (event) =>
          event.definitionKey != null &&
          keys.has(event.definitionKey) &&
          types.has(event.eventType)
      )
      .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
      .slice(0, capped)
      .map((event) => structuredClone(event));
  }

  async listAdminFilterOptions(): Promise<AuditFilterOptions> {
    const actorsByValue = new Map<string, AuditActorOption>();
    const definitionKeys = new Set<string>();
    for (const event of this.events) {
      const value = (event.actorId ?? event.actorName ?? '').trim();
      if (value && !actorsByValue.has(value)) {
        const name = (event.actorName ?? '').trim();
        const id = (event.actorId ?? '').trim();
        const label =
          name && id && name.toLowerCase() !== id.toLowerCase() ? `${name} (${id})` : name || id;
        actorsByValue.set(value, { value, label });
      }
      if (event.definitionKey?.trim()) {
        definitionKeys.add(event.definitionKey.trim());
      }
    }
    return {
      actors: [...actorsByValue.values()].sort((left, right) =>
        left.label.localeCompare(right.label, undefined, { sensitivity: 'base' })
      ),
      definitionKeys: [...definitionKeys].sort((left, right) =>
        left.localeCompare(right, undefined, { sensitivity: 'base' })
      )
    };
  }
}
