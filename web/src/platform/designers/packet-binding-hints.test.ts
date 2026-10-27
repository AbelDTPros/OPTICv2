import { describe, expect, it } from 'vitest';
import type { StageFormDefinition } from '../../../../src/modules/configuration/domain/types.js';
import {
  collectChildPacketBindingHints,
  collectParentPacketBindingHints,
  hintsForField,
  packetBindingChipLabel,
  packetBindingDetail
} from './packet-binding-hints.js';

const intakeForm: StageFormDefinition = {
  formKey: 'MAIL_INTAKE',
  dataPath: '$.intake',
  title: 'Intake',
  sections: [
    {
      sectionKey: 'HEADER',
      title: 'Header',
      fields: [
        {
          fieldKey: 'RECEIVED_DATE',
          path: '$.receivedDate',
          component: 'DATE_INPUT',
          label: 'Received Date'
        }
      ]
    }
  ]
};

const docPrepForm: StageFormDefinition = {
  formKey: 'MAIL_DOC_PREP',
  dataPath: '$',
  title: 'Doc Prep',
  sections: [
    {
      sectionKey: 'WORKLOADS',
      title: 'Workloads',
      repeatable: true,
      path: '$.workloads',
      spawnDefinitionKey: 'I_407_WORKLOAD',
      packetFieldBindings: [
        {
          bindingKey: 'RECEIVED',
          parentFieldKey: 'RECEIVED_DATE',
          childFieldKey: 'RECEIVED_DATE',
          mode: 'INHERIT_ONCE',
          parentScope: 'PACKET'
        },
        {
          bindingKey: 'STATUS',
          parentFieldKey: 'WORKLOAD_STATUS',
          childFieldKey: 'WORKLOAD_STATUS',
          mode: 'PROJECT_CHILD',
          parentScope: 'ROW'
        }
      ],
      fields: [
        {
          fieldKey: 'WORKLOAD_STATUS',
          path: '$.workloadStatus',
          component: 'RADIO',
          label: 'Status'
        }
      ]
    }
  ]
};

describe('packet-binding-hints', () => {
  it('indexes parent hints onto the form that owns the field', () => {
    const hints = collectParentPacketBindingHints({
      MAIL_INTAKE: intakeForm,
      MAIL_DOC_PREP: docPrepForm
    });
    const received = hintsForField(hints, 'MAIL_INTAKE', 'RECEIVED_DATE');
    expect(received).toHaveLength(1);
    expect(packetBindingChipLabel(received[0]!)).toBe('→ workload once');
    expect(packetBindingDetail(received[0]!)).toContain('I_407_WORKLOAD');
    expect(packetBindingDetail(received[0]!)).toMatch(/^Field link:/);

    const status = hintsForField(hints, 'MAIL_DOC_PREP', 'WORKLOAD_STATUS');
    expect(status).toHaveLength(1);
    expect(packetBindingChipLabel(status[0]!)).toBe('↔ workload live');
  });

  it('indexes child hints from a mail release that spawns the workload', () => {
    const hints = collectChildPacketBindingHints(
      { MAIL_INTAKE: intakeForm, MAIL_DOC_PREP: docPrepForm },
      'MAIL_ITEM',
      'I_407_WORKLOAD',
      { mailDisplayName: 'Mail item' }
    );
    expect(hintsForField(hints, 'ANY', 'RECEIVED_DATE')).toHaveLength(1);
    expect(packetBindingChipLabel(hintsForField(hints, 'ANY', 'RECEIVED_DATE')[0]!)).toBe('← mail once');
    expect(packetBindingDetail(hintsForField(hints, 'ANY', 'WORKLOAD_STATUS')[0]!)).toContain('Mail item');
    expect(packetBindingDetail(hintsForField(hints, 'ANY', 'WORKLOAD_STATUS')[0]!)).toMatch(/^Field link:/);
  });
});
