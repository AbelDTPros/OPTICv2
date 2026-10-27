import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import * as configApi from './config-api.js';
import { blankDesignerForm, demoDesignerForm } from './demo-draft.js';
import { FormDesigner } from './FormDesigner.js';

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(configApi, 'listDefinitions').mockResolvedValue([
    { definitionKey: 'I_407_WORKLOAD', displayName: 'I-407 Workload', entityType: 'WORKLOAD' }
  ]);
});

function Harness({ onSave, entityType }: { onSave?: () => void; entityType?: string }) {
  const [form, setForm] = useState(demoDesignerForm);
  return <FormDesigner form={form} entityType={entityType} onChange={setForm} onSave={onSave} />;
}

describe('FormDesigner', () => {
  it('renders palette, canvas, and properties without accessibility violations', async () => {
    const { container } = render(<Harness />);
    expect(screen.getByRole('heading', { level: 1, name: 'Form designer' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Component palette' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Properties' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select A-Number, optional' })).toBeInTheDocument();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('adds a palette field to the selected section', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Text' }));
    expect(screen.getByRole('button', { name: 'Select Text, optional' })).toBeInTheDocument();
    expect(screen.getByLabelText('Field key')).toHaveValue('TEXT_INPUT');
  });

  it('moves a field up with the keyboard control', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Move Receipt Number up' }));
    const fields = screen.getAllByRole('button', { name: /^Select / });
    expect(fields[0]).toHaveAccessibleName('Select Receipt Number, optional');
  });

  it('reorders sections with the keyboard control', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Add section' }));
    await user.click(screen.getByRole('button', { name: 'Move section New section up' }));
    const newSection = screen.getByRole('button', { name: 'New section' });
    const applicant = screen.getByRole('button', { name: 'Applicant Information' });
    expect(newSection.compareDocumentPosition(applicant) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('emphasizes Save draft only while the form differs from the saved release', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    function DirtyHarness() {
      const [form, setForm] = useState(demoDesignerForm);
      return (
        <FormDesigner
          form={form}
          savedForm={demoDesignerForm}
          onChange={setForm}
          onSave={onSave}
        />
      );
    }
    render(<DirtyHarness />);
    const saved = screen.getByRole('button', { name: 'Saved' });
    expect(saved).toBeDisabled();
    expect(saved).toHaveClass('optic-button-save-clean');
    await user.click(screen.getByText(/Identity ·/));
    await user.clear(screen.getByLabelText('Form title'));
    await user.type(screen.getByLabelText('Form title'), 'Changed');
    const save = screen.getByRole('button', { name: 'Save draft' });
    expect(save).toBeEnabled();
    expect(save).toHaveClass('optic-button-primary');
  });

  it('saves the draft from the toolbar', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        formKey: 'I90_DATA_ENTRY',
        schema: expect.objectContaining({
          additionalProperties: false,
          properties: expect.objectContaining({
            ANumber: { type: 'string' },
            receiptNumber: { type: 'string' }
          })
        })
      })
    );
    expect(
      (onSave.mock.calls[0]?.[0] as { schema?: { properties?: Record<string, unknown> } }).schema?.properties
    ).not.toHaveProperty('textInput');
  });

  it('drops a removed palette field from schema and UI JSON', async () => {
    const user = userEvent.setup();
    let latest = demoDesignerForm;
    function Capture() {
      const [form, setForm] = useState(demoDesignerForm);
      latest = form;
      return <FormDesigner form={form} onChange={setForm} />;
    }
    render(<Capture />);
    await user.click(screen.getByRole('button', { name: 'Text' }));
    expect((latest.schema?.properties as Record<string, unknown> | undefined)?.textInput).toEqual({ type: 'string' });
    await user.click(screen.getByRole('button', { name: 'Remove Text' }));
    expect((latest.schema?.properties as Record<string, unknown> | undefined)?.textInput).toBeUndefined();
    await user.click(screen.getByRole('button', { name: 'UI JSON' }));
    expect((screen.getByLabelText('Form UI JSON') as HTMLTextAreaElement).value).not.toContain('"textInput"');
  });

  it('retargets path when a generated field key is renamed', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Text' }));
    const fieldKey = screen.getByLabelText('Field key');
    await user.clear(fieldKey);
    await user.type(fieldKey, 'BOX_NUMBER');
    expect(screen.getByLabelText('Path')).toHaveValue('$.boxNumber');
  });

  it('includes conditional checkbox effects in the saved form', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: /Add behavior/ }));
    await user.selectOptions(screen.getByLabelText('Target field'), 'A_NUMBER');
    await user.selectOptions(screen.getByLabelText('Path'), '$.dataEntryDetails.ANumber');
    await user.click(screen.getByLabelText('Required when matched'));
    await user.click(screen.getByLabelText('Read-only when matched'));
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        behaviors: [
          expect.objectContaining({
            effects: [
              expect.objectContaining({
                fieldKey: 'A_NUMBER',
                visible: true,
                required: true,
                readOnly: true
              })
            ]
          })
        ]
      })
    );
  });

  it('filters conditional behaviors to the selected field with an option to show all', async () => {
    const user = userEvent.setup();
    function BehaviorHarness() {
      const [form, setForm] = useState({
        ...demoDesignerForm,
        behaviors: [
          {
            behaviorKey: 'SHOW_A',
            when: { path: '$.receiptNumber', operator: 'EXISTS' as const },
            effects: [{ fieldKey: 'A_NUMBER', visible: true }]
          },
          {
            behaviorKey: 'REQ_RECEIPT',
            when: { path: '$.ANumber', operator: 'EXISTS' as const },
            effects: [{ fieldKey: 'RECEIPT_NUMBER', required: true }]
          }
        ]
      });
      return <FormDesigner form={form} onChange={setForm} />;
    }
    render(<BehaviorHarness />);
    await user.click(screen.getByRole('button', { name: /Select A-Number/ }));
    expect(screen.getByText(/Showing behaviors for A_NUMBER/)).toBeInTheDocument();
    expect(screen.getByLabelText('Behavior 1')).toBeInTheDocument();
    expect(screen.queryByLabelText('Behavior 2')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Show all conditional behaviors'));
    expect(screen.getByLabelText('Behavior 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Behavior 2')).toBeInTheDocument();
  });

  it('edits SELECT options and required behavior effects', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Dropdown' }));
    expect(screen.getByLabelText('Options')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Add behavior/ }));
    expect(screen.getByLabelText('Required when matched')).toBeInTheDocument();
    expect(screen.getByLabelText('Read-only when matched')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Required when matched'));
    expect(screen.getByLabelText('Required when matched')).toBeChecked();
  });

  it('adds radio buttons with a choice count and labeled options', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Radio buttons' }));
    expect(screen.getByRole('status', { name: 'Current palette type' })).toHaveTextContent('Radio buttons');
    const count = screen.getByLabelText('Number of radio buttons');
    expect(count).toHaveValue(2);
    await user.clear(count);
    await user.type(count, '3');
    expect(count).toHaveValue(3);
    expect(screen.getByLabelText('Option 3 label')).toHaveValue('Option 3');
    const firstLabel = screen.getByLabelText('Option 1 label');
    await user.clear(firstLabel);
    await user.type(firstLabel, 'Card');
    const firstValue = screen.getByLabelText('Option 1 value');
    await user.clear(firstValue);
    await user.type(firstValue, 'CARD');
    expect(firstLabel).toHaveValue('Card');
    expect(firstValue).toHaveValue('CARD');
  });

  it('keeps dropdown properties open while editing the label and options', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Dropdown' }));
    const label = screen.getByLabelText('Label');
    await user.clear(label);
    await user.type(label, 'Country');
    expect(label).toHaveValue('Country');
    expect(label).toHaveFocus();
    expect(screen.queryByText('Field was removed.')).not.toBeInTheDocument();

    const options = screen.getByLabelText('Options');
    await user.click(options);
    await user.type(options, 'US|United States{Enter}CA|Canada');
    expect(options).toHaveValue('US|United States\nCA|Canada');
    expect(options).toHaveFocus();
  });

  it('keeps the palette type visible after the field label changes', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Dropdown' }));
    const label = screen.getByLabelText('Label');
    await user.clear(label);
    await user.type(label, 'Country of birth');
    expect(screen.getByLabelText('Palette type')).toHaveDisplayValue('Dropdown');
    expect(screen.getByRole('status', { name: 'Current palette type' })).toHaveTextContent('Dropdown');
    expect(screen.getByRole('button', { name: 'Select Country of birth, optional' })).toHaveTextContent('Dropdown');
  });

  it('numbers behaviors and nested conditions', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /Add behavior/ }));
    expect(screen.getByLabelText('Behavior 1')).toHaveTextContent('1.');
    await user.selectOptions(screen.getByLabelText('Group'), 'all');
    await user.click(screen.getByRole('button', { name: 'Add condition' }));
    expect(screen.getByRole('group', { name: 'Condition 1' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Condition 2' })).toBeInTheDocument();
  });

  it('offers GREATER_THAN and LESS_THAN for behavior operators', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /Add behavior/ }));
    const operator = screen.getByLabelText('Operator');
    expect(within(operator).getByRole('option', { name: 'GREATER_THAN' })).toBeInTheDocument();
    expect(within(operator).getByRole('option', { name: 'LESS_THAN' })).toBeInTheDocument();
  });

  it('switches a behavior When group to all', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /Add behavior/ }));
    await user.selectOptions(screen.getByLabelText('Group'), 'all');
    expect(screen.getByRole('button', { name: 'Add condition' })).toBeInTheDocument();
  });

  it('removes an individual when condition', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /Add behavior/ }));
    await user.selectOptions(screen.getByLabelText('Group'), 'all');
    await user.click(screen.getByRole('button', { name: 'Add condition' }));
    expect(screen.getByRole('group', { name: 'Condition 2' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove condition 2' }));
    expect(screen.queryByRole('group', { name: 'Condition 2' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Condition 1' })).toBeInTheDocument();
  });

  it('keeps section properties open while editing the title', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Applicant Information' }));
    const sectionTitle = screen.getByLabelText('Title');
    await user.clear(sectionTitle);
    await user.type(sectionTitle, 'Household');
    expect(sectionTitle).toHaveValue('Household');
    expect(sectionTitle).toHaveFocus();
    expect(screen.queryByText('Section was removed.')).not.toBeInTheDocument();
  });

  it('sets Fill from Assigned officer on a text field', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: 'Text' }));
    await user.selectOptions(screen.getByLabelText('Fill from'), 'ASSIGNED_TO');
    expect(screen.getByLabelText('Fill from')).toHaveValue('ASSIGNED_TO');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    const saved = onSave.mock.calls[0]?.[0] as {
      sections: Array<{ fields: Array<{ fieldKey: string; fillFrom?: string }> }>;
    };
    expect(saved.sections[0]?.fields.find((field) => field.fieldKey === 'TEXT_INPUT')?.fillFrom).toBe(
      'ASSIGNED_TO'
    );
  });

  it('hides Fill from on receipt number and offers Today on a date', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Select Receipt Number, optional' }));
    expect(screen.queryByLabelText('Fill from')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Date' }));
    expect(screen.getByLabelText('Fill from')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Fill from'), 'TODAY');
    expect(screen.getByLabelText('Fill from')).toHaveValue('TODAY');
    expect(screen.getByText(/US Eastern Time/)).toBeInTheDocument();
  });

  it('keeps field properties open while renaming the field key', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Select A-Number, optional' }));
    const fieldKey = screen.getByLabelText('Field key');
    await user.clear(fieldKey);
    await user.type(fieldKey, 'A_NUM');
    expect(fieldKey).toHaveValue('A_NUM');
    expect(fieldKey).toHaveFocus();
    expect(screen.queryByText('Field was removed.')).not.toBeInTheDocument();
  });

  it('repeats a mail section from Add Workload in preview', async () => {
    const user = userEvent.setup();
    render(<Harness entityType="MAIL" />);
    await user.click(screen.getByRole('button', { name: 'Add section' }));
    await user.click(screen.getByRole('button', { name: 'New section' }));
    await user.click(screen.getByLabelText('Repeat this section'));
    expect(screen.getAllByText('Repeats').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Radio buttons' }));
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    await user.click(screen.getByRole('button', { name: 'Add Workload' }));
    expect(screen.getByRole('group', { name: 'Workload 1' })).toBeInTheDocument();
    expect(
      screen.getByText(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    ).toBeInTheDocument();
  });

  it('lets an author pick a workload definition for spawned cases', async () => {
    const user = userEvent.setup();
    vi.mocked(configApi.listDefinitions).mockResolvedValue([
      { definitionKey: 'I_407_WORKLOAD', displayName: 'I-407 Workload', entityType: 'WORKLOAD' },
      { definitionKey: 'I_407_MAILITEM', displayName: 'I 407 Mail Item', entityType: 'MAIL' }
    ]);
    render(<Harness entityType="MAIL" />);
    await user.click(screen.getByRole('button', { name: 'Add section' }));
    await user.click(screen.getByRole('button', { name: 'New section' }));
    await user.click(screen.getByLabelText('Repeat this section'));
    const spawn = await screen.findByLabelText('Create cases of definition');
    expect(spawn.tagName).toBe('SELECT');
    expect(screen.getByRole('option', { name: 'I-407 Workload (I_407_WORKLOAD)' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /I_407_MAILITEM/ })).not.toBeInTheDocument();
    await user.selectOptions(spawn, 'I_407_WORKLOAD');
    expect(spawn).toHaveValue('I_407_WORKLOAD');
  });

  it('lets an author set minimum copies on a repeating section and generate schema minItems', async () => {
    const user = userEvent.setup();
    render(<Harness entityType="MAIL" />);
    await user.click(screen.getByRole('button', { name: 'Add section' }));
    await user.click(screen.getByRole('button', { name: 'New section' }));
    await user.click(screen.getByLabelText('Repeat this section'));
    const minimum = screen.getByLabelText('Minimum copies');
    await user.clear(minimum);
    await user.type(minimum, '1');
    expect(minimum).toHaveValue(1);
    await user.click(screen.getByRole('button', { name: 'Form schema' }));
    await user.click(screen.getByRole('button', { name: 'Generate schema' }));
    const schema = JSON.parse((screen.getByLabelText('JSON Schema') as HTMLTextAreaElement).value) as {
      required?: string[];
      properties?: { workloads?: { minItems?: number } };
    };
    expect(schema.required).toContain('workloads');
    expect(schema.properties?.workloads?.minItems).toBe(1);
  });

  it('lets an author require exact copies from the Count field', async () => {
    const user = userEvent.setup();
    render(<Harness entityType="MAIL" />);
    await user.click(screen.getByRole('button', { name: 'Number' }));
    await user.click(screen.getByRole('button', { name: 'Add section' }));
    await user.click(screen.getByRole('button', { name: 'New section' }));
    await user.click(screen.getByLabelText('Repeat this section'));
    const countField = screen.getByLabelText('Count field');
    await user.selectOptions(countField, screen.getByRole('option', { name: /Number/i }));
    expect(countField).not.toHaveValue('');
    const match = screen.getByLabelText('Require exact copies from Count field');
    await user.click(match);
    expect(match).toBeChecked();
    expect(screen.queryByLabelText('Minimum copies')).not.toBeInTheDocument();
  });

  it('generates JSON Schema from the canvas', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Form schema' }));
    await user.click(screen.getByRole('button', { name: 'Generate schema' }));
    const schema = screen.getByLabelText('JSON Schema') as HTMLTextAreaElement;
    expect(schema.value).toContain('"ANumber"');
    expect(schema.value).toContain('"receiptNumber"');
  });

  it('writes required and validation rules from Properties into generated schema', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Select Receipt Number, optional' }));
    await user.click(screen.getByLabelText('Required on Complete'));
    const minLength = screen.getByLabelText('Minimum length');
    await user.clear(minLength);
    await user.type(minLength, '13');
    expect(screen.getByRole('button', { name: 'Select Receipt Number, required' })).toHaveTextContent('Required');
    await user.click(screen.getByRole('button', { name: 'Form schema' }));
    await user.click(screen.getByRole('button', { name: 'Generate schema' }));
    const schema = JSON.parse((screen.getByLabelText('JSON Schema') as HTMLTextAreaElement).value) as {
      required?: string[];
      properties?: { receiptNumber?: { minLength?: number } };
    };
    expect(schema.required).toContain('receiptNumber');
    expect(schema.properties?.receiptNumber?.minLength).toBe(13);
  });

  it('shows date bounds instead of length rules for a Date field', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Date' }));
    expect(screen.getByLabelText('Earliest date')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('Latest date')).toHaveAttribute('type', 'date');
    expect(screen.queryByLabelText('Minimum length')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Pattern')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Earliest date'), { target: { value: '2020-01-01' } });
    fireEvent.change(screen.getByLabelText('Latest date'), { target: { value: '2030-12-31' } });
    await user.click(screen.getByRole('button', { name: 'Form schema' }));
    await user.click(screen.getByRole('button', { name: 'Generate schema' }));
    const schema = JSON.parse((screen.getByLabelText('JSON Schema') as HTMLTextAreaElement).value) as {
      properties?: { dateInput?: { format?: string; minDate?: string; maxDate?: string; minLength?: number } };
    };
    expect(schema.properties?.dateInput).toMatchObject({
      type: 'string',
      format: 'date',
      minDate: '2020-01-01',
      maxDate: '2030-12-31'
    });
    expect(schema.properties?.dateInput?.minLength).toBeUndefined();
  });

  it('hides length and number rules for radios and dropdowns', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Radio buttons' }));
    expect(screen.getByLabelText('Required on Complete')).toBeInTheDocument();
    expect(screen.queryByLabelText('Minimum length')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Minimum')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Earliest date')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Number' }));
    expect(screen.getByLabelText('Minimum')).toBeInTheDocument();
    expect(screen.getByLabelText('Maximum')).toBeInTheDocument();
    expect(screen.queryByLabelText('Minimum length')).not.toBeInTheDocument();
  });

  it('shows packet binding flags on the parent field canvas and in Properties', async () => {
    const user = userEvent.setup();
    const mailForm = {
      ...demoDesignerForm,
      formKey: 'MAIL_DOC_PREP',
      sections: [
        {
          sectionKey: 'PACKET',
          title: 'Packet',
          fields: [
            {
              fieldKey: 'RECEIVED_DATE',
              path: '$.receivedDate',
              component: 'DATE_INPUT' as const,
              label: 'Received Date'
            }
          ]
        },
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
              mode: 'INHERIT_ONCE' as const,
              parentScope: 'PACKET' as const
            }
          ],
          fields: [
            {
              fieldKey: 'TRACKING_ID',
              path: '$.trackingId',
              component: 'TRACKING_ID_DISPLAY' as const,
              label: 'Tracking'
            }
          ]
        }
      ]
    };
    function BindingHarness() {
      const [form, setForm] = useState(mailForm);
      return <FormDesigner form={form} entityType="MAIL" releaseForms={{ MAIL_DOC_PREP: form }} onChange={setForm} />;
    }
    render(<BindingHarness />);
    const chip = screen.getByRole('button', { name: /Select Received Date.*→ workload once/ });
    expect(chip).toHaveTextContent('→ workload once');
    await user.click(chip);
    expect(
      screen.getByText(/Field link: Copy once when workload is created · workload field RECEIVED_DATE on I_407_WORKLOAD/)
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Workloads' }));
    expect(screen.getByRole('group', { name: 'Copy fields to spawned workloads' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Expand field link 1:/ })).toHaveTextContent(
      'Received Date → RECEIVED_DATE · copy once'
    );
    await user.click(screen.getByRole('button', { name: /Expand field link 1:/ }));
    expect(screen.getByLabelText('Field on this mail packet')).toHaveValue('RECEIVED_DATE');
    expect(screen.getByLabelText('When to copy')).toHaveDisplayValue('Copy once when workload is created');
  });

  it('keeps identity fields under a collapsible strip and shows empty-canvas help', async () => {
    const user = userEvent.setup();
    function EmptyHarness() {
      const [form, setForm] = useState(blankDesignerForm);
      return <FormDesigner form={form} onChange={setForm} />;
    }
    render(<EmptyHarness />);
    expect(screen.getByRole('group', { name: 'Edit actions' })).toBeInTheDocument();
    expect(screen.getByText(/Identity ·/)).toBeInTheDocument();
    expect(screen.getByText('Build the officer form')).toBeInTheDocument();
    await user.click(screen.getByText(/Identity ·/));
    expect(screen.getByLabelText('Form title')).toBeInTheDocument();
    expect(screen.getByLabelText('formKey')).toHaveValue(blankDesignerForm.formKey);
  });

  it('links a read-only field to another form field via Display from', async () => {
    const user = userEvent.setup();
    const payment = {
      formKey: 'PAYMENT',
      dataPath: '$.payment',
      title: 'Payment',
      sections: [
        {
          sectionKey: 'PAY',
          title: 'Pay',
          fields: [
            {
              fieldKey: 'PAY_GOV_TRACKING_ID',
              path: '$.payGovTrackingId',
              component: 'TEXT_INPUT',
              label: 'Pay.gov tracking ID'
            }
          ]
        }
      ]
    };
    const report = {
      formKey: 'REPORT',
      dataPath: '$.report',
      title: 'Report',
      sections: [
        {
          sectionKey: 'SUMMARY',
          title: 'Summary',
          layout: 'ONE_COLUMN',
          fields: [
            {
              fieldKey: 'TRACKING_DISPLAY',
              path: '$.local',
              component: 'READ_ONLY_VALUE',
              label: 'Pay.gov tracking ID'
            }
          ]
        }
      ]
    };
    let saved = report;
    function DisplayFromHarness() {
      const [form, setForm] = useState(report);
      return (
        <FormDesigner
          form={form}
          releaseForms={{ PAYMENT: payment, REPORT: form }}
          onChange={(next) => {
            saved = next;
            setForm(next);
          }}
        />
      );
    }
    render(<DisplayFromHarness />);
    await user.click(screen.getByRole('button', { name: /Select Pay\.gov tracking ID/ }));
    await user.selectOptions(screen.getByLabelText('Display from form'), 'PAYMENT');
    await user.selectOptions(screen.getByLabelText('Display from field'), 'PAY_GOV_TRACKING_ID');
    expect(saved.sections[0]?.fields[0]?.displayFromFormKey).toBe('PAYMENT');
    expect(saved.sections[0]?.fields[0]?.displayFromFieldKey).toBe('PAY_GOV_TRACKING_ID');
    expect(screen.getByRole('button', { name: /← Payment · Pay\.gov tracking ID/ })).toBeInTheDocument();
  });
});
