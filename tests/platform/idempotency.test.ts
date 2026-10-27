import { describe, expect, it } from 'vitest';
import { hashIdempotencyRequest } from '../../src/platform/idempotency/idempotency.repository.js';
import { InMemoryIdempotencyRepository } from '../../src/platform/idempotency/in-memory-idempotency.repository.js';
import { replayOrExecute } from '../../src/platform/idempotency/replay.js';

const actor = { actorId: 'officer@example.gov', roles: ['OFFICER'], correlationId: 'c-idemp' };

describe('idempotency replay', () => {
  it('hashes request objects stably regardless of key order', () => {
    expect(hashIdempotencyRequest({ expectedRowVersion: 1, dataPatch: { a: 1 } })).toBe(
      hashIdempotencyRequest({ dataPatch: { a: 1 }, expectedRowVersion: 1 })
    );
  });

  it('replays the first success and rejects a different body for the same key', async () => {
    const repository = new InMemoryIdempotencyRepository();
    let runs = 0;
    const first = await replayOrExecute(repository, actor, 'assign:WORKLOAD:W-1', 'k1', { expectedRowVersion: 1 }, async () => {
      runs += 1;
      return { rowVersion: 2 };
    });
    const replayed = await replayOrExecute(
      repository,
      actor,
      'assign:WORKLOAD:W-1',
      'k1',
      { expectedRowVersion: 1 },
      async () => {
        runs += 1;
        return { rowVersion: 99 };
      }
    );
    expect(first).toEqual({ rowVersion: 2 });
    expect(replayed).toEqual({ rowVersion: 2 });
    expect(runs).toBe(1);

    await expect(
      replayOrExecute(repository, actor, 'assign:WORKLOAD:W-1', 'k1', { expectedRowVersion: 9 }, async () => ({
        rowVersion: 3
      }))
    ).rejects.toMatchObject({ errorCode: 'OPTIC-WF-40906' });
  });
});
