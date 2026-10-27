import { log } from '../logging/logger.js';
import type { AppendSplunkEventInput, SplunkEventRepository, SplunkSink } from './splunk-event.repository.js';

export class RepositorySplunkSink implements SplunkSink {
  constructor(private readonly repository: SplunkEventRepository) {}

  async emit(event: AppendSplunkEventInput): Promise<void> {
    await this.repository.append(event);
    log('info', 'Splunk-safe event projected', {
      event: 'splunk.projected',
      eventType: event.eventType,
      eventId: event.eventId,
      correlationId: event.correlationId
    });
  }
}
