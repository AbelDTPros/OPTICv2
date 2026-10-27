import { describe, expect, it } from 'vitest';
import { OutboxPipeline } from '../../src/platform/outbox/outbox.pipeline.js';
import type { SplunkSink } from '../../src/platform/splunk/splunk-event.repository.js';
import { seedPublishedLinear } from '../helpers/publish-linear.js';
import { createTestRuntime, testConfig } from '../helpers/test-app.js';

const actor = {
  actorId: 'officer@example.gov',
  roles: ['OFFICER'],
  correlationId: 'c-audit-pipeline'
};

function pipelineFor(
  runtime: ReturnType<typeof createTestRuntime>,
  overrides: Partial<typeof testConfig.outboxPublisher> = {},
  splunkSink?: SplunkSink
): OutboxPipeline {
  return new OutboxPipeline(
    runtime.outbox,
    runtime.deliveries,
    runtime.audit,
    runtime.splunk,
    {
      ...testConfig.outboxPublisher,
      enabled: true,
      workerId: overrides.workerId ?? 'pipeline-test',
      ...overrides
    },
    splunkSink ? { splunkSink } : undefined
  );
}

async function saveReceipt(runtime: ReturnType<typeof createTestRuntime>, trackingId: string): Promise<void> {
  await seedPublishedLinear(runtime);
  const created = await runtime.workflow.createInstance(actor, {
    entityType: 'WORKLOAD',
    entityTrackingId: trackingId,
    definitionKey: 'I_90'
  });
  const assigned = await runtime.workflow.assignToSelf(actor, {
    entityType: 'WORKLOAD',
    entityTrackingId: trackingId,
    expectedRowVersion: created.workflow.rowVersion
  });
  await runtime.workflow.saveDraft(actor, {
    entityType: 'WORKLOAD',
    entityTrackingId: trackingId,
    expectedRowVersion: assigned.workflow.rowVersion,
    dataPatch: { dataEntryDetails: { receiptNumber: 'ABC1234567890' } }
  });
}

describe('OutboxPipeline', () => {
  it('writes full field values to audit and masked values to the Splunk projection', async () => {
    const runtime = createTestRuntime();
    await saveReceipt(runtime, 'W-AUDIT-1');
    const changed = runtime.outbox.events.find((event) => event.eventType === 'FIELD_CHANGED');
    expect(changed).toBeDefined();

    const tick = await pipelineFor(runtime).tick();
    expect(tick.published).toBeGreaterThan(0);
    expect(tick.auditPublished).toBeGreaterThan(0);
    expect(tick.splunkPublished).toBeGreaterThan(0);

    const audit = runtime.audit.events.find((event) => event.eventType === 'FIELD_CHANGED');
    const splunk = runtime.splunk.events.find((event) => event.eventType === 'FIELD_CHANGED');
    expect(audit?.correlationId).toBe('c-audit-pipeline');
    expect(splunk?.correlationId).toBe('c-audit-pipeline');

    const auditDeltas = (audit?.eventData.fieldDeltas as Array<Record<string, unknown>>) ?? [];
    const splunkDeltas = (splunk?.payload.fieldDeltas as Array<Record<string, unknown>>) ?? [];
    const auditChanges = (audit?.eventData.changes as Array<Record<string, unknown>>) ?? [];
    const splunkChanges = (splunk?.payload.changes as Array<Record<string, unknown>>) ?? [];
    expect(auditDeltas[0]?.after).toBe('ABC1234567890');
    expect(auditChanges[0]).toMatchObject({
      fieldKey: 'RECEIPT_NUMBER',
      classification: 'SENSITIVE',
      after: 'ABC1234567890'
    });
    expect(splunkDeltas[0]?.after).toBe('A*********890');
    expect(splunkChanges[0]?.after).toBe('A*********890');
    expect(JSON.stringify(splunk?.payload)).not.toContain('ABC1234567890');
  });

  it('keeps the audit write when the Splunk consumer fails and retries independently', async () => {
    const runtime = createTestRuntime();
    await saveReceipt(runtime, 'W-AUDIT-2');
    const failing: SplunkSink = {
      async emit() {
        throw new Error('splunk unavailable');
      }
    };
    const worker = pipelineFor(
      runtime,
      { workerId: 'splunk-fail', backoffBaseMs: 0, defaultMaxAttempts: 5 },
      failing
    );

    const first = await worker.tick();
    expect(first.auditPublished).toBeGreaterThan(0);
    expect(first.splunkRetried).toBeGreaterThan(0);
    expect(runtime.audit.events.some((event) => event.eventType === 'FIELD_CHANGED')).toBe(true);
    expect(runtime.splunk.events).toHaveLength(0);

    const splunkDelivery = runtime.deliveries.rows.find((row) => row.consumerKey === 'SPLUNK');
    expect(splunkDelivery?.status).toBe('PENDING');
    expect(splunkDelivery?.attemptCount).toBe(1);
  });

  it('dead-letters a Splunk delivery after max attempts', async () => {
    const runtime = createTestRuntime();
    await saveReceipt(runtime, 'W-AUDIT-3');
    const failing: SplunkSink = {
      async emit() {
        throw new Error('splunk unavailable');
      }
    };
    const worker = pipelineFor(
      runtime,
      { workerId: 'splunk-dlq', backoffBaseMs: 0, defaultMaxAttempts: 1 },
      failing
    );
    const tick = await worker.tick();
    expect(tick.splunkFailed).toBeGreaterThan(0);
    const splunkDelivery = runtime.deliveries.rows.find((row) => row.consumerKey === 'SPLUNK');
    expect(splunkDelivery?.status).toBe('DEAD_LETTER');
  });

  it('does not duplicate audit or Splunk rows on a second tick', async () => {
    const runtime = createTestRuntime();
    await saveReceipt(runtime, 'W-AUDIT-4');
    const worker = pipelineFor(runtime, { workerId: 'replay' });
    await worker.tick();
    const auditCount = runtime.audit.events.length;
    const splunkCount = runtime.splunk.events.length;
    const replay = await worker.tick();
    expect(replay.published).toBe(0);
    expect(runtime.audit.events).toHaveLength(auditCount);
    expect(runtime.splunk.events).toHaveLength(splunkCount);
    expect(runtime.outbox.events.every((event) => event.publishStatus === 'PUBLISHED')).toBe(true);
  });

  it('redrives a dead-lettered Splunk delivery so a later tick can succeed', async () => {
    const runtime = createTestRuntime();
    await saveReceipt(runtime, 'W-AUDIT-5');
    const failing: SplunkSink = {
      async emit() {
        throw new Error('splunk unavailable');
      }
    };
    const failingWorker = pipelineFor(
      runtime,
      { workerId: 'splunk-redrive-fail', backoffBaseMs: 0, defaultMaxAttempts: 1 },
      failing
    );
    await failingWorker.tick();
    expect(runtime.deliveries.rows.some((row) => row.consumerKey === 'SPLUNK' && row.status === 'DEAD_LETTER')).toBe(
      true
    );

    const redriven = await failingWorker.redriveDeadLetters('SPLUNK');
    expect(redriven.deliveries).toBeGreaterThan(0);
    const recovered = await pipelineFor(runtime, { workerId: 'splunk-redrive-ok' }).tick();
    expect(recovered.splunkPublished).toBeGreaterThan(0);
    expect(runtime.splunk.events.some((event) => event.eventType === 'FIELD_CHANGED')).toBe(true);
  });
});
