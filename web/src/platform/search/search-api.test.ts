import { afterEach, describe, expect, it, vi } from 'vitest';
import { findCases } from './search-api.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ data })
  } as Response;
}

describe('findCases definition scope', () => {
  it('passes a single definitionKey when the workload type has one member', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        q: 'W-1',
        page: 1,
        pageSize: 25,
        total: 1,
        hits: [
          {
            trackingId: 'W-1',
            entityType: 'WORKLOAD',
            definitionKey: 'I_G325A_WORKLOAD',
            version: '0.1.0',
            currentStageKey: 'READY_FOR_DATA_ENTRY',
            assignedTo: null,
            slaState: null,
            rowVersion: 1,
            matchedFields: []
          }
        ]
      })
    );
    await findCases({ q: 'W-1', definitionKeys: ['I_G325A_WORKLOAD'] });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('definitionKey=I_G325A_WORKLOAD');
  });

  it('searches each member definition and merges hits for a mail+workload type', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      const mail = url.includes('I_G325A_MAILITEM');
      return jsonResponse({
        q: '1',
        page: 1,
        pageSize: 25,
        total: 1,
        hits: [
          {
            trackingId: mail ? 'M-1' : 'W-1',
            entityType: mail ? 'MAIL' : 'WORKLOAD',
            definitionKey: mail ? 'I_G325A_MAILITEM' : 'I_G325A_WORKLOAD',
            version: '0.1.0',
            currentStageKey: 'READY_FOR_DATA_ENTRY',
            assignedTo: null,
            slaState: null,
            rowVersion: 1,
            matchedFields: []
          }
        ]
      });
    });
    const page = await findCases({
      q: '1',
      definitionKeys: ['I_G325A_MAILITEM', 'I_G325A_WORKLOAD']
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(page.hits.map((hit) => hit.trackingId).sort()).toEqual(['M-1', 'W-1']);
  });
});
