import type { AppendSplunkEventInput, SplunkEventRecord, SplunkEventRepository } from './splunk-event.repository.js';

export class InMemorySplunkEventRepository implements SplunkEventRepository {
  readonly events: SplunkEventRecord[] = [];
  private nextId = 1;

  async append(input: AppendSplunkEventInput): Promise<SplunkEventRecord> {
    const existing = this.events.find((event) => event.eventId === input.eventId);
    if (existing) {
      return structuredClone(existing);
    }
    const record: SplunkEventRecord = {
      id: this.nextId++,
      eventId: input.eventId,
      eventType: input.eventType,
      occurredAt: input.occurredAt,
      correlationId: input.correlationId,
      payload: structuredClone(input.payload),
      createdAt: new Date()
    };
    this.events.push(record);
    return structuredClone(record);
  }

  async findByEventId(eventId: string): Promise<SplunkEventRecord | null> {
    const event = this.events.find((row) => row.eventId === eventId);
    return event ? structuredClone(event) : null;
  }

  async listByCorrelationId(correlationId: string): Promise<SplunkEventRecord[]> {
    return this.events
      .filter((event) => event.correlationId === correlationId)
      .map((event) => structuredClone(event));
  }
}
