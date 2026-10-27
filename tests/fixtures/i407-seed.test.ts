import { describe, expect, it } from 'vitest';
import { i407MailRelease, i407WorkloadRelease } from '../../src/modules/configuration/fixtures/i407.js';
import { assertPublishableDefinition } from '../../src/modules/configuration/service/publish-validation.js';
import { resolveTransition } from '../../src/rules/transition-resolver.js';

describe('I-407 seed fixtures', () => {
  it('can publish the mail definition', () => {
    expect(() => assertPublishableDefinition(i407MailRelease)).not.toThrow();
    expect(i407MailRelease.workflow.initialStageKey).toBe('NEW_MAIL_ITEM');
    expect(i407MailRelease.queues.NEW_MAIL_ITEM?.displayName).toBe('New Mail Item');
    expect(i407MailRelease.forms.I_407_MAILITEM?.title).toBe('I 407 Mail Item');
    expect(i407MailRelease.forms.I_407_DOC_PREP?.formKey).toBe('I_407_DOC_PREP');
  });

  it('can publish the workload definition', () => {
    expect(() => assertPublishableDefinition(i407WorkloadRelease)).not.toThrow();
  });

  it('routes I-407 data entry complete by workloadStatus, not the snake_case miss', () => {
    const fromDataEntry = i407WorkloadRelease.workflow.transitionSets.find(
      (set) => set.transitionSetKey === 'FROM_DATA_ENTRY'
    );
    expect(fromDataEntry).toBeDefined();
    expect(
      resolveTransition(fromDataEntry!, {
        businessData: { dataEntryDetails: { workloadStatus: 'Accepted' } }
      }).targetStageKey
    ).toBe('READY_FOR_SHREDDING');
    expect(
      resolveTransition(fromDataEntry!, {
        businessData: { dataEntryDetails: { workloadStatus: 'Rejected' } }
      }).targetStageKey
    ).toBe('READY_FOR_SHIPPING');
    expect(
      resolveTransition(fromDataEntry!, {
        businessData: { dataEntryDetails: { workloadStatus: 'Fraud Review' } }
      }).targetStageKey
    ).toBe('READY_FOR_SHIPPING');
    expect(
      resolveTransition(fromDataEntry!, {
        businessData: { dataEntryDetails: { workload_status: 'Accepted' } }
      }).usedDefault
    ).toBe(true);
  });
});
