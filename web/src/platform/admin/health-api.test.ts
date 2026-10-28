import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchHealthReady } from './health-api.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchHealthReady', () => {
  it('maps a ready response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok', checks: { process: 'up', database: 'up' } })
      })
    );
    await expect(fetchHealthReady()).resolves.toEqual({
      status: 'ok',
      process: 'up',
      database: 'up',
      httpStatus: 200
    });
    expect(fetch).toHaveBeenCalledWith('/health/ready');
  });

  it('maps database down as unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ status: 'unavailable', checks: { process: 'up', database: 'down' } })
      })
    );
    await expect(fetchHealthReady()).resolves.toEqual({
      status: 'unavailable',
      process: 'up',
      database: 'down',
      httpStatus: 503
    });
  });

  it('maps network failure as unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(fetchHealthReady()).resolves.toEqual({
      status: 'unreachable',
      process: 'unknown',
      database: 'unknown'
    });
  });
});
