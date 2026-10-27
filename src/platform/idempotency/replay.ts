import { conflict } from '../errors/app-error.js';
import type { ActorContext } from '../security/actor.js';
import { hashIdempotencyRequest, type IdempotencyRepository } from './idempotency.repository.js';

export async function replayOrExecute<T>(
  repository: IdempotencyRepository,
  actor: ActorContext,
  operation: string,
  idempotencyKey: string | undefined,
  request: unknown,
  work: () => Promise<T>
): Promise<T> {
  if (!idempotencyKey) {
    return work();
  }
  const requestHash = hashIdempotencyRequest(request);
  const existing = await repository.find(actor.actorId, operation, idempotencyKey);
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw conflict(
        'OPTIC-WF-40906',
        'This request was already processed with a different body. Use a new idempotency key.'
      );
    }
    return structuredClone(existing.response) as T;
  }
  const response = await work();
  await repository.save({
    actorId: actor.actorId,
    operation,
    idempotencyKey,
    requestHash,
    response
  });
  return response;
}
