import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowSummary } from '../designers/workflow-api.js';
import { labelForSummary, labelsForPacket, printLabels } from './labels.js';

const mail: WorkflowSummary = {
  trackingId: 'MAIL-1',
  entityType: 'MAIL',
  workflowInstanceId: 1,
  status: 'COMPLETED',
  definition: { definitionKey: 'I_407_MAILITEM', version: '0.1.0', releaseId: '1' },
  workflow: {
    currentStageKey: 'COMPLETED',
    currentStageLabel: 'Completed',
    enteredStageAt: '2026-09-04T00:00:00.000Z',
    assignedTo: null,
    rowVersion: 1,
    openVisitNumber: 1
  },
  businessData: {},
  allowedActions: [],
  stageForm: null,
  visits: []
};

const workload: WorkflowSummary = {
  ...mail,
  trackingId: 'WL-1',
  entityType: 'WORKLOAD',
  workflowInstanceId: 2,
  status: 'ACTIVE',
  definition: { definitionKey: 'I_407_WORKLOAD', version: '0.1.0', releaseId: '2' },
  workflow: {
    ...mail.workflow,
    currentStageKey: 'READY_FOR_DATA_ENTRY',
    currentStageLabel: 'Ready for Data Entry'
  },
  businessData: { dataEntryDetails: { workloadStatus: 'Accepted' } },
  packet: { parent: mail }
};

describe('workspace labels', () => {
  it('encodes entity type and tracking id on the sticker payload', () => {
    expect(labelForSummary(workload).payload).toBe('OPTIC:WORKLOAD:WL-1');
    expect(labelForSummary(workload).kindLabel).toBe('I-407');
    expect(labelForSummary(workload).statusCaption).toBe('Workload status');
    expect(labelForSummary(workload).statusText).toBe('Accepted');
    expect(labelForSummary(workload).stageLabel).toBe('Ready for Data Entry');
  });

  it('omits instance ACTIVE/COMPLETED from mail stickers (stage is enough)', () => {
    const label = labelForSummary(mail);
    expect(label.statusCaption).toBeUndefined();
    expect(label.statusText).toBeUndefined();
    expect(label.stageLabel).toBe('Completed');
  });

  it('reads shared $.workload.workloadStatus when present', () => {
    const shared: WorkflowSummary = {
      ...workload,
      businessData: { workload: { workloadStatus: 'Fraud Review' }, dataEntryDetails: {} }
    };
    expect(labelForSummary(shared).statusText).toBe('Fraud Review');
  });

  it('omits ACTIVE/COMPLETED from workload stickers when status is unset', () => {
    const unset: WorkflowSummary = { ...workload, businessData: { dataEntryDetails: {} } };
    expect(labelForSummary(unset).statusText).toBe('');
    expect(labelForSummary(unset).statusText).not.toBe('ACTIVE');
  });

  it('prints the workload and its parent mail item together', () => {
    expect(labelsForPacket(workload).map((label) => label.trackingId)).toEqual(['WL-1', 'MAIL-1']);
  });

  it('opens a print window without noopener so the document handle stays usable', () => {
    const print = vi.fn();
    const focus = vi.fn();
    const close = vi.fn();
    const write = vi.fn();
    const frame = {
      document: { write, close },
      focus,
      print,
      opener: window
    };
    const open = vi.spyOn(window, 'open').mockReturnValue(frame as unknown as Window);
    printLabels([labelForSummary(workload)], { 'OPTIC:WORKLOAD:WL-1': '<svg></svg>' });
    expect(open).toHaveBeenCalledWith('', '_blank', 'width=720,height=640');
    expect(write).toHaveBeenCalled();
    expect(frame.opener).toBeNull();
    expect(print).toHaveBeenCalled();
  });

  it('explains when the browser blocks the print window', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    expect(() => printLabels([labelForSummary(workload)], {})).toThrow(/pop-up/i);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
