import { describe, expect, it } from 'vitest';
import { matchProjection, searchableFields } from '../../src/modules/search/domain/match.js';
import type { QueueProjectionRecord } from '../../src/modules/queue/domain/types.js';

function row(overrides: Partial<QueueProjectionRecord> = {}): QueueProjectionRecord {
  return {
    workflowInstanceId: 1,
    entityType: 'WORKLOAD',
    entityTrackingId: 'W-2001',
    definitionKey: 'I_90',
    definitionReleaseId: 1,
    workloadType: 'I-90',
    currentStageKey: 'READY_FOR_DATA_ENTRY',
    assignedTo: 'officer@example.gov',
    branchKey: null,
    locationKey: null,
    priority: null,
    receivedAt: new Date(),
    enteredStageAt: new Date(),
    slaState: null,
    receiptNumber: 'ABC1234567890',
    status: 'ACTIVE',
    rowVersion: 1,
    projectedJson: { receiptNumber: 'ABC1234567890' },
    updatedAt: new Date(),
    ...overrides
  };
}

describe('search match', () => {
  it('matches tracking id separately from receipt number', () => {
    const fields = searchableFields([]);
    expect(matchProjection(row(), fields, { trackingId: 'W-20' }).some((hit) => hit.fieldKey === 'trackingId')).toBe(true);
    expect(matchProjection(row(), fields, { receiptNumber: 'ABC123' }).some((hit) => hit.fieldKey === 'receiptNumber')).toBe(
      true
    );
    expect(matchProjection(row(), fields, { trackingId: 'ABC123' })).toEqual([]);
    expect(matchProjection(row(), fields, { receiptNumber: 'W-20' })).toEqual([]);
    expect(matchProjection(row(), fields, { trackingId: 'NOPE' })).toEqual([]);
  });

  it('matches receipt number from the projection column when the authored path is nested', () => {
    const fields = searchableFields([
      { fieldKey: 'receiptNumber', source: 'BUSINESS_DATA', path: '$.dataEntryDetails.receiptNumber', match: 'EXACT_PREFIX', pii: true }
    ]);
    expect(
      matchProjection(row(), fields, { receiptNumber: 'ABC123' }).some((hit) => hit.fieldKey === 'receiptNumber')
    ).toBe(true);
  });

  it('matches a tracking id from the middle of the value', () => {
    const fields = searchableFields([]);
    expect(matchProjection(row(), fields, { trackingId: '2001' }).some((hit) => hit.fieldKey === 'trackingId')).toBe(true);
  });

  it('matches system tracking id even when projected json has a different trackingId', () => {
    const fields = searchableFields([]);
    const poisoned = row({
      projectedJson: { trackingId: 'GUID-FROM-FORM', receiptNumber: 'ABC1234567890' }
    });
    expect(
      matchProjection(poisoned, fields, { trackingId: 'W-2001' }).some((hit) => hit.fieldKey === 'trackingId')
    ).toBe(true);
    expect(matchProjection(poisoned, fields, { trackingId: 'GUID-FROM-FORM' })).toEqual([]);
  });

  it('matches catalog extra criteria from projected json', () => {
    const fields = searchableFields([
      { fieldKey: 'Status', source: 'BUSINESS_DATA', path: '$.Status', match: 'EXACT_PREFIX', pii: false }
    ]);
    const withStatus = row({ projectedJson: { receiptNumber: 'ABC1234567890', Status: 'Accepted' } });
    expect(
      matchProjection(withStatus, fields, { extras: { Status: 'Acc' } }).some((hit) => hit.fieldKey === 'Status')
    ).toBe(true);
    expect(matchProjection(withStatus, fields, { extras: { Status: 'Rejected' } })).toEqual([]);
    expect(matchProjection(row(), fields, { extras: { Status: 'Acc' } })).toEqual([]);
  });

  it('matches Status when path is $workflow.workloadStatus but value is projected as workloadStatus', () => {
    const fields = searchableFields([
      {
        fieldKey: 'Status',
        source: 'BUSINESS_DATA',
        path: '$workflow.workloadStatus',
        match: 'FUZZY',
        pii: false
      }
    ]);
    const withStatus = row({
      projectedJson: { receiptNumber: 'MNT1233232441', workloadStatus: 'Accepted' }
    });
    expect(
      matchProjection(withStatus, fields, { extras: { Status: 'accepted' } }).some(
        (hit) => hit.fieldKey === 'Status' && hit.value === 'Accepted'
      )
    ).toBe(true);
  });

  it('matches A-Number from business data when it is not yet projected', () => {
    const fields = searchableFields([
      {
        fieldKey: 'A_NUMBER',
        source: 'BUSINESS_DATA',
        path: '$.dataEntryDetails.aNumber',
        match: 'CONTAINS',
        pii: true
      }
    ]);
    const businessData = {
      dataEntryDetails: { aNumber: 'A123343', receiptNumber: 'ABC1234567890' }
    };
    expect(
      matchProjection(row(), fields, { extras: { A_NUMBER: '123343' } }, businessData).some(
        (hit) => hit.fieldKey === 'A_NUMBER' && hit.value === 'A123343'
      )
    ).toBe(true);
    expect(matchProjection(row(), fields, { extras: { A_NUMBER: '123343' } })).toEqual([]);
  });
});
