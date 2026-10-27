import { describe, expect, it } from 'vitest';
import {
  blankAction,
  blankBulkAction,
  blankQueue,
  blankScheduledAction,
  collectActionIssues,
  entityTypeForCatalogItem,
  nextProjectedField,
  collectBulkIssues,
  collectEligibilityIssues,
  collectQueueIssues,
  collectScheduledIssues,
  collectSlaIssues
} from './catalog-model.js';

describe('catalog designer model', () => {
  it('rejects a missing action label', () => {
    expect(collectActionIssues({ ...blankAction(), label: '' }).some((issue) => issue.path === 'label')).toBe(true);
  });

  it('rejects a non-positive SLA target', () => {
    expect(
      collectSlaIssues({
        slaKey: 'DATA_ENTRY_SLA',
        clock: 'CALENDAR',
        target: { durationHours: 0 },
        warningThresholdPercent: 75,
        breachThresholdPercent: 100,
        severityOnBreach: 'HIGH'
      }).some((issue) => issue.path === 'target.durationHours')
    ).toBe(true);
  });

  it('stamps a new queue with the requested entity type', () => {
    expect(blankQueue('MAIL').entityType).toBe('MAIL');
    expect(blankQueue().entityType).toBe('WORKLOAD');
  });

  it('reads entity type from a catalog item or the definition key suffix', () => {
    expect(
      entityTypeForCatalogItem({ definitionKey: 'I_407_MAILITEM', entityType: 'MAIL' })
    ).toBe('MAIL');
    expect(
      entityTypeForCatalogItem({ definitionKey: 'I_407_WORKLOAD', entityType: 'WORKLOAD' })
    ).toBe('WORKLOAD');
    expect(entityTypeForCatalogItem({ definitionKey: 'I_407_MAIL_ITEM' })).toBe('MAIL');
    expect(entityTypeForCatalogItem({ definitionKey: 'I_90' })).toBe('WORKLOAD');
  });

  it('suggests applicant name fields for queue projection', () => {
    const first = nextProjectedField([]);
    expect(first).toEqual({
      fieldKey: 'firstName',
      label: 'Applicant First Name',
      path: '$.dataEntryDetails.firstName'
    });
    expect(nextProjectedField([first]).fieldKey).toBe('lastName');
  });

  it('rejects a projected field without a JSONPath', () => {
    expect(
      collectQueueIssues({
        ...blankQueue(),
        projectedFields: [{ fieldKey: 'firstName', label: 'Applicant First Name', path: 'dataEntryDetails.firstName' }]
      }).some((issue) => issue.path === 'projectedFields.0.path')
    ).toBe(true);
  });

  it('rejects an empty eligibility all[]', () => {
    expect(collectEligibilityIssues({ all: [] }, 'eligibility').some((issue) => issue.path === 'eligibility.all')).toBe(true);
    expect(
      collectQueueIssues({ ...blankQueue(), eligibility: { all: [] } }).some((issue) => issue.path === 'eligibility.all')
    ).toBe(true);
  });

  it('rejects incomplete bulk and scheduled actions', () => {
    expect(collectBulkIssues({ ...blankBulkAction(), maxSelection: 0 }).some((issue) => issue.path === 'maxSelection')).toBe(
      true
    );
    expect(
      collectScheduledIssues({
        ...blankScheduledAction(),
        action: { type: 'TRANSITION' }
      }).some((issue) => issue.path === 'action.targetStage')
    ).toBe(true);
  });
});
