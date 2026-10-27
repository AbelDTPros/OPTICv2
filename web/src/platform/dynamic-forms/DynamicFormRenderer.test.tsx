import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { demoDataEntryForm } from './demo-form.js';
import { DynamicFormRenderer, type FormFieldError } from './DynamicFormRenderer.js';
import type { StageFormDefinition } from '../../../../src/modules/configuration/domain/types.js';

const TRACKING_ID = /^W-[0-9A-HJKMNP-TV-Z]{10}$/;

const baseValue = {
  ANumber: 'A123456789',
  receiptNumber: 'ABC1234567890',
  applicationCount: 1,
  siuCompleteDate: '2026-08-01',
  paymentType: 'Card',
  voucherNumber: '',
  digitalFileUploaded: false,
  notes: 'Ready',
  trackingId: 'W-2001'
};

function Harness({
  workflowContext,
  errors,
  errorSummary
}: {
  workflowContext?: Record<string, unknown>;
  errors?: FormFieldError[];
  errorSummary?: string;
}) {
  const [value, setValue] = useState<unknown>(baseValue);
  return (
    <DynamicFormRenderer
      form={demoDataEntryForm}
      schema={demoDataEntryForm.schema}
      value={value}
      workflowContext={workflowContext ?? { currentStageKey: 'READY_FOR_DATA_ENTRY' }}
      errors={errors}
      errorSummary={errorSummary}
      onChange={setValue}
    />
  );
}

describe('DynamicFormRenderer', () => {
  it('renders labeled fields, sections, and has no automated accessibility violations', async () => {
    const { container } = render(<Harness />);
    expect(screen.getByRole('heading', { level: 1, name: 'Data Entry' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Applicant Information' })).toBeInTheDocument();
    expect(screen.getByLabelText(/A-Number/)).toHaveAttribute('id', 'field-A_NUMBER');
    expect(screen.getByLabelText('Receipt Number')).toBeInTheDocument();
    expect(screen.getByLabelText('Application count')).toHaveAttribute('type', 'number');
    expect(screen.getByLabelText('SIU Complete Date')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('Payment type')).toBeInTheDocument();
    expect(screen.getByLabelText('Digital file uploaded')).toHaveAttribute('type', 'checkbox');
    expect(screen.getByLabelText('Notes')).toBeInTheDocument();
    expect(screen.getByText('W-2001')).toBeInTheDocument();
    expect(screen.queryByLabelText('Voucher number')).not.toBeInTheDocument();

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('shows a required voucher field when payment type is Check(s)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.selectOptions(screen.getByLabelText('Payment type'), 'Check(s)');
    const voucher = screen.getByLabelText(/Voucher number/);
    expect(voucher).toBeRequired();
    expect(voucher).toHaveAccessibleDescription(/Required when payment is by check/);
  });

  it('makes receipt number read-only from a workflow rule', () => {
    render(<Harness workflowContext={{ currentStageKey: 'COMPLETED' }} />);
    expect(screen.getByLabelText('Receipt Number')).toHaveProperty('readOnly', true);
  });

  it('associates an error summary and inline field error', async () => {
    const { container } = render(
      <Harness
        errorSummary="Request validation failed. Review the highlighted fields and try again."
        errors={[{ fieldKey: 'A_NUMBER', message: 'A-Number is required.', inputId: 'field-A_NUMBER' }]}
      />
    );
    const summary = screen.getByRole('alert');
    expect(summary).toHaveTextContent('There is a problem');
    expect(screen.getByRole('link', { name: 'A-Number is required.' })).toHaveAttribute('href', '#field-A_NUMBER');
    expect(screen.getByLabelText(/A-Number/)).toHaveAccessibleErrorMessage('A-Number is required.');
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('names yes/no radios from a visible legend and binds the group error', async () => {
    const form: StageFormDefinition = {
      formKey: 'YES_NO_FORM',
      dataPath: '$.decision',
      title: 'Eligibility',
      sections: [
        {
          sectionKey: 'MAIN',
          title: 'Decision',
          fields: [
            {
              fieldKey: 'ELIGIBLE',
              path: '$.eligible',
              component: 'YES_NO_RADIO',
              label: 'Eligible'
            }
          ]
        }
      ]
    };
    const { container } = render(
      <DynamicFormRenderer
        form={form}
        value={{}}
        errors={[{ fieldKey: 'ELIGIBLE', message: 'Choose Yes or No.', inputId: 'field-ELIGIBLE' }]}
        onChange={() => undefined}
      />
    );
    expect(screen.getByRole('radiogroup', { name: 'Eligible' })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('radio', { name: 'Yes' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'No' })).toBeInTheDocument();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('renders configured radio choices and stores the selected value', async () => {
    const user = userEvent.setup();
    const form: StageFormDefinition = {
      formKey: 'RADIO_FORM',
      dataPath: '$.decision',
      title: 'Decision',
      sections: [
        {
          sectionKey: 'MAIN',
          title: 'Choice',
          fields: [
            {
              fieldKey: 'PAYMENT',
              path: '$.paymentType',
              component: 'RADIO',
              label: 'Payment type',
              options: [
                { value: 'CARD', label: 'Card' },
                { value: 'CHECK', label: 'Check' },
                { value: 'VOUCHER', label: 'Voucher' }
              ]
            }
          ]
        }
      ]
    };
    function RadioHarness() {
      const [value, setValue] = useState<unknown>({});
      return <DynamicFormRenderer form={form} value={value} onChange={setValue} />;
    }
    render(<RadioHarness />);
    expect(screen.getByRole('radiogroup', { name: 'Payment type' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    await user.click(screen.getByRole('radio', { name: 'Check' }));
    expect(screen.getByRole('radio', { name: 'Check' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Card' })).not.toBeChecked();
  });

  it('shows the instance tracking id on Mail Tracking # when form data is empty', () => {
    const form: StageFormDefinition = {
      formKey: 'MAIL_ITEM',
      dataPath: '$',
      title: 'Mail item',
      sections: [
        {
          sectionKey: 'HEADER',
          title: 'Header',
          fields: [
            {
              fieldKey: 'TRACKING_ID',
              path: '$.trackingId',
              component: 'TRACKING_ID_DISPLAY',
              label: 'Mail Tracking #'
            }
          ]
        }
      ]
    };
    render(
      <DynamicFormRenderer
        form={form}
        value={{}}
        workflowContext={{ trackingId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', entityType: 'MAIL' }}
        onChange={() => undefined}
      />
    );
    expect(screen.getByText('Mail Tracking #')).toBeInTheDocument();
    expect(screen.getByText('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBeInTheDocument();
  });

  it('shows another form field via Display from without owning the path', () => {
    const payment: StageFormDefinition = {
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
    const report: StageFormDefinition = {
      formKey: 'REPORT',
      dataPath: '$.report',
      title: 'Report',
      sections: [
        {
          sectionKey: 'SUMMARY',
          title: 'Summary',
          fields: [
            {
              fieldKey: 'TRACKING_DISPLAY',
              path: '$.localCopy',
              component: 'READ_ONLY_VALUE',
              label: 'Pay.gov tracking ID',
              displayFromFormKey: 'PAYMENT',
              displayFromFieldKey: 'PAY_GOV_TRACKING_ID'
            }
          ]
        }
      ]
    };
    render(
      <DynamicFormRenderer
        form={report}
        value={{}}
        businessData={{ payment: { payGovTrackingId: 'PG-12345' } }}
        releaseForms={{ PAYMENT: payment, REPORT: report }}
        onChange={() => undefined}
      />
    );
    expect(screen.getByText('Pay.gov tracking ID')).toBeInTheDocument();
    expect(screen.getByText('PG-12345')).toBeInTheDocument();
  });

  it('reads shared and stage fields from businessData when value is only a dataPath slice', () => {
    const form: StageFormDefinition = {
      formKey: 'I936_SCANNING_DETAILS',
      dataPath: '$.scanningDetails',
      title: 'Scanning',
      sections: [
        {
          sectionKey: 'TRACKING',
          title: 'Tracking',
          fields: [
            {
              fieldKey: 'WORKLOAD_STATUS',
              path: '$.workload.workloadStatus',
              component: 'SELECT',
              label: 'Workload Status',
              options: [
                { label: 'Accepted', value: 'Accepted' },
                { label: 'Rejected', value: 'Rejected' }
              ]
            },
            {
              fieldKey: 'APPLICANT_FIRST_NAME',
              path: '$.applicantFirstName',
              component: 'TEXT_INPUT',
              label: 'Applicant First Name'
            }
          ]
        }
      ]
    };
    render(
      <DynamicFormRenderer
        form={form}
        value={{ applicantFirstName: 'John' }}
        businessData={{
          workload: { workloadStatus: 'Accepted' },
          scanningDetails: { applicantFirstName: 'John' }
        }}
        onChange={() => undefined}
      />
    );
    expect(screen.getByDisplayValue('John')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Accepted')).toBeInTheDocument();
  });

  it('shows the assigned officer on a Fill from field', () => {
    const form: StageFormDefinition = {
      formKey: 'I407_DATA_ENTRY',
      dataPath: '$.dataEntryDetails',
      title: 'Data Entry',
      sections: [
        {
          sectionKey: 'TRACKING',
          title: 'Tracking',
          fields: [
            {
              fieldKey: 'DATA_KEYER_NAME',
              path: '$.dataKeyerName',
              component: 'READ_ONLY_VALUE',
              label: 'Data Keyer Name',
              fillFrom: 'ASSIGNED_TO'
            }
          ]
        }
      ]
    };
    render(
      <DynamicFormRenderer
        form={form}
        value={{}}
        workflowContext={{ assignedTo: 'officer@example.gov' }}
        onChange={() => undefined}
      />
    );
    expect(screen.getByText('Data Keyer Name')).toBeInTheDocument();
    expect(screen.getByText('officer@example.gov')).toBeInTheDocument();
  });

  it('shows the instance tracking id on a read-only Workload Tracking #', () => {
    const form: StageFormDefinition = {
      formKey: 'I407_DATA_ENTRY',
      dataPath: '$.dataEntryDetails',
      title: 'Data Entry',
      sections: [
        {
          sectionKey: 'TRACKING',
          title: 'Tracking',
          fields: [
            {
              fieldKey: 'WORKLOAD_TRACKING_ID',
              path: '$.trackingId',
              component: 'READ_ONLY_VALUE',
              label: 'Workload Tracking #'
            }
          ]
        }
      ]
    };
    render(
      <DynamicFormRenderer
        form={form}
        value={{}}
        workflowContext={{ trackingId: 'c14012ce-e446-452a-baaa-c09f3def5f44', entityType: 'WORKLOAD' }}
        onChange={() => undefined}
      />
    );
    expect(screen.getByText('Workload Tracking #')).toBeInTheDocument();
    expect(screen.getByText('c14012ce-e446-452a-baaa-c09f3def5f44')).toBeInTheDocument();
  });

  it('mints a workload tracking id when Add Workload creates a copy', async () => {
    const user = userEvent.setup();
    const form: StageFormDefinition = {
      formKey: 'MAIL_FORM',
      dataPath: '$.mail',
      title: 'Mail item',
      sections: [
        {
          sectionKey: 'WORKLOADS',
          title: 'Workloads',
          repeatable: true,
          path: '$.workloads',
          addButtonLabel: 'Add Workload',
          itemLabel: 'Workload',
          fields: [
            { fieldKey: 'TRACKING_ID', path: '$.trackingId', component: 'TRACKING_ID_DISPLAY', label: 'Tracking ID' },
            {
              fieldKey: 'CHOICE',
              path: '$.choice',
              component: 'RADIO',
              label: 'Type',
              options: [
                { value: 'I90', label: 'I-90' },
                { value: 'I131', label: 'I-131' }
              ]
            }
          ]
        }
      ]
    };
    function GroupHarness() {
      const [value, setValue] = useState<unknown>({});
      return (
        <DynamicFormRenderer
          form={form}
          value={value}
          workflowContext={{ trackingId: 'MAIL-SHOULD-NOT-FILL-ROWS' }}
          onChange={setValue}
        />
      );
    }
    render(<GroupHarness />);
    await user.click(screen.getByRole('button', { name: 'Add Workload' }));
    expect(screen.getByRole('group', { name: 'Workload 1' })).toBeInTheDocument();
    const firstId = screen.getAllByText(TRACKING_ID)[0]?.textContent;
    expect(firstId).toMatch(TRACKING_ID);
    expect(screen.queryByText('MAIL-SHOULD-NOT-FILL-ROWS')).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'I-131' }));
    expect(screen.getByRole('radio', { name: 'I-131' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Add Workload' }));
    expect(screen.getByRole('group', { name: 'Workload 2' })).toBeInTheDocument();
    const minted = screen.getAllByText(TRACKING_ID).map((node) => node.textContent);
    expect(minted).toHaveLength(2);
    expect(minted[0]).not.toBe(minted[1]);
  });

  it('adds as many workloads as the number field and applies the radio choice to each', async () => {
    const user = userEvent.setup();
    const form: StageFormDefinition = {
      formKey: 'MAIL_FORM',
      dataPath: '$.mail',
      title: 'Mail item',
      sections: [
        {
          sectionKey: 'CONTROLS',
          title: 'How many',
          fields: [
            { fieldKey: 'COUNT', path: '$.count', component: 'NUMBER_INPUT', label: 'How many workloads' },
            {
              fieldKey: 'TYPE',
              path: '$.type',
              component: 'RADIO',
              label: 'Workload type',
              options: [
                { value: 'I90', label: 'I-90' },
                { value: 'I131', label: 'I-131' }
              ]
            }
          ]
        },
        {
          sectionKey: 'WORKLOADS',
          title: 'Workloads',
          repeatable: true,
          path: '$.workloads',
          addButtonLabel: 'Add Workload',
          itemLabel: 'Workload',
          countFieldKey: 'COUNT',
          choiceSourceFieldKey: 'TYPE',
          fields: [
            { fieldKey: 'TRACKING_ID', path: '$.trackingId', component: 'TRACKING_ID_DISPLAY', label: 'Tracking ID' },
            {
              fieldKey: 'CHOICE',
              path: '$.choice',
              component: 'RADIO',
              label: 'Type',
              options: [
                { value: 'I90', label: 'I-90' },
                { value: 'I131', label: 'I-131' }
              ]
            }
          ]
        }
      ]
    };
    function GroupHarness() {
      const [value, setValue] = useState<unknown>({});
      return <DynamicFormRenderer form={form} value={value} onChange={setValue} />;
    }
    render(<GroupHarness />);
    await user.type(screen.getByLabelText('How many workloads'), '3');
    await user.click(screen.getByRole('radio', { name: 'I-131' }));
    await user.click(screen.getByRole('button', { name: 'Add Workload' }));
    expect(screen.getByRole('group', { name: 'Workload 3' })).toBeInTheDocument();
    expect(screen.getAllByText(TRACKING_ID)).toHaveLength(3);
    expect(screen.getAllByRole('radio', { name: 'I-131' }).filter((radio) => (radio as HTMLInputElement).checked)).toHaveLength(4);
  });
});
