import { describe, expect, it } from 'vitest';
import { InMemoryAuditEventRepository } from '../../src/platform/audit/in-memory-audit-event.repository.js';
import { computeEventHash, canonicalAudit } from '../../src/platform/audit/hash-chain.js';

describe('audit hash chaining', () => {
  it('links event_hash to the previous hash in the entity partition', async () => {
    const audit = new InMemoryAuditEventRepository();
    const firstInput = {
      eventId: '11111111-1111-1111-1111-111111111111',
      eventType: 'WORKLOAD_CREATED',
      occurredAt: new Date('2026-08-23T12:00:00.000Z'),
      actorId: 'officer@example.gov',
      actorName: 'Officer',
      sessionId: 's-1',
      correlationId: 'c-1',
      sourceService: 'api-server',
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-1',
      definitionKey: 'I_90',
      definitionVersion: '1.0.0',
      stageKey: 'READY_FOR_DATA_ENTRY',
      actionKey: null,
      eventData: { eventType: 'WORKLOAD_CREATED' }
    };
    const first = await audit.append(firstInput);
    expect(first.previousHash).toBeNull();
    expect(first.eventHash).toBe(computeEventHash(canonicalAudit(firstInput), null));

    const secondInput = {
      ...firstInput,
      eventId: '22222222-2222-2222-2222-222222222222',
      eventType: 'FIELD_CHANGED',
      correlationId: 'c-2',
      eventData: { eventType: 'FIELD_CHANGED' }
    };
    const second = await audit.append(secondInput);
    expect(second.previousHash).toBe(first.eventHash);
    expect(second.eventHash).toBe(computeEventHash(canonicalAudit(secondInput), first.eventHash));
  });

  it('is idempotent for a repeated event_id', async () => {
    const audit = new InMemoryAuditEventRepository();
    const input = {
      eventId: '33333333-3333-3333-3333-333333333333',
      eventType: 'WORKLOAD_CREATED',
      occurredAt: new Date('2026-08-23T12:00:00.000Z'),
      actorId: 'officer@example.gov',
      actorName: 'Officer',
      sessionId: null,
      correlationId: 'c-3',
      sourceService: 'api-server',
      entityType: 'WORKLOAD',
      entityTrackingId: 'W-2',
      definitionKey: 'I_90',
      definitionVersion: '1.0.0',
      stageKey: null,
      actionKey: null,
      eventData: {}
    };
    const first = await audit.append(input);
    const second = await audit.append(input);
    expect(second.eventHash).toBe(first.eventHash);
    expect(audit.events).toHaveLength(1);
  });
});
