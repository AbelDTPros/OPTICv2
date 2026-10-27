import { describe, expect, it } from 'vitest';
import type { QueueDefinition, SearchDefinition } from '../../../../src/modules/configuration/domain/types.js';
import {
  ensureSearchFieldProjected,
  listProjectedSearchOptions,
  removeSearchFieldProjection,
  uniqueExtraSearchFields
} from './catalog-model.js';

function queueWith(
  queueKey: string,
  projectedFields: NonNullable<QueueDefinition['projectedFields']>
): QueueDefinition {
  return {
    queueKey,
    displayName: queueKey,
    entityType: 'WORKLOAD',
    eligibility: { all: [] },
    defaultSort: [],
    columns: ['trackingId'],
    filters: [],
    actions: [],
    pageSize: 25,
    projectedFields
  };
}

describe('projected search options', () => {
  it('keeps one Find a case choice when queues repeat the same label', () => {
    const options = listProjectedSearchOptions({
      A: queueWith('A', [
        {
          fieldKey: 'APPLICANT_FIRST_NAME',
          label: 'Applicant First Name',
          path: '$.scanningDetails.applicantFirstName'
        },
        { fieldKey: 'workloadStatus', label: 'Status', path: '$.workload.workloadStatus' }
      ]),
      B: queueWith('B', [
        { fieldKey: 'firstName', label: 'Applicant First Name', path: '$.dataEntryDetails.firstName' }
      ])
    });
    expect(options.map((option) => option.label)).toEqual(['Applicant First Name', 'Status']);
    expect(options.find((option) => option.label === 'Applicant First Name')?.fieldKey).toBe('firstName');
  });

  it('collapses Status and workloadStatus extras into one editor row', () => {
    const options = listProjectedSearchOptions({
      A: queueWith('A', [
        { fieldKey: 'workloadStatus', label: 'Status', path: '$.workload.workloadStatus' }
      ])
    });
    const search: SearchDefinition = {
      searchKey: 'DEFAULT',
      fields: [
        {
          fieldKey: 'Status',
          source: 'BUSINESS_DATA',
          path: '$workflow.workloadStatus',
          match: 'FUZZY',
          pii: false
        },
        {
          fieldKey: 'workloadStatus',
          source: 'BUSINESS_DATA',
          path: '$.workload.workloadStatus',
          match: 'CONTAINS',
          pii: false
        }
      ]
    };
    expect(uniqueExtraSearchFields(search, options)).toHaveLength(1);
  });

  it('removes search-only projections when a Find a case filter is dropped', () => {
    const queues = ensureSearchFieldProjected(
      { A: queueWith('A', []) },
      { fieldKey: 'A_NUMBER', label: 'A Number', path: '$.dataEntryDetails.aNumber' }
    );
    expect(queues.A?.projectedFields).toEqual([
      { fieldKey: 'A_NUMBER', label: 'A Number', path: '$.dataEntryDetails.aNumber' }
    ]);
    const remaining: SearchDefinition = { searchKey: 'DEFAULT', fields: [] };
    const next = removeSearchFieldProjection(
      queues,
      { fieldKey: 'A_NUMBER', path: '$.dataEntryDetails.aNumber' },
      remaining
    );
    expect(next.A?.projectedFields).toEqual([]);
  });

  it('keeps a projection that is still a queue column', () => {
    const queues = {
      A: queueWith('A', [
        { fieldKey: 'firstName', label: 'First Name', path: '$.dataEntryDetails.firstName' }
      ])
    };
    queues.A.columns = ['trackingId', 'firstName'];
    const next = removeSearchFieldProjection(
      queues,
      { fieldKey: 'firstName', path: '$.dataEntryDetails.firstName' },
      { searchKey: 'DEFAULT', fields: [] }
    );
    expect(next.A?.projectedFields).toHaveLength(1);
  });
});
