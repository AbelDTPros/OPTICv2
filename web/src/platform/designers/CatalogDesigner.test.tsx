import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import type { QueueDefinition } from '../../../../src/modules/configuration/domain/types.js';
import { CatalogDesigner } from './CatalogDesigner.js';
import {
  demoDesignerAction,
  demoDesignerBulk,
  demoDesignerForm,
  demoDesignerQueue,
  demoDesignerScheduled,
  demoDesignerSearch,
  demoDesignerSla,
  demoDesignerWorkflow
} from './demo-draft.js';

function renderCatalog(overrides: Partial<ComponentProps<typeof CatalogDesigner>> = {}) {
  const onActionsChange = vi.fn();
  const onQueuesChange = vi.fn();
  const onBulkActionsChange = vi.fn();
  const onScheduledActionsChange = vi.fn();
  const result = render(
    <CatalogDesigner
      actions={{ [demoDesignerAction.actionKey]: demoDesignerAction }}
      queues={{ [demoDesignerQueue.queueKey]: demoDesignerQueue }}
      slas={{ [demoDesignerSla.slaKey]: demoDesignerSla }}
      search={demoDesignerSearch}
      bulkActions={{ [demoDesignerBulk.bulkActionKey]: demoDesignerBulk }}
      scheduledActions={{ [demoDesignerScheduled.scheduledActionKey]: demoDesignerScheduled }}
      forms={{ [demoDesignerForm.formKey]: demoDesignerForm }}
      stageKeys={['READY_FOR_DATA_ENTRY', 'COMPLETED']}
      transitionSetKeys={['FROM_DATA_ENTRY', 'FROM_REVIEW']}
      onActionsChange={onActionsChange}
      onQueuesChange={onQueuesChange}
      onSlasChange={vi.fn()}
      onSearchChange={vi.fn()}
      onBulkActionsChange={onBulkActionsChange}
      onScheduledActionsChange={onScheduledActionsChange}
      {...overrides}
    />
  );
  return { ...result, onActionsChange, onQueuesChange, onBulkActionsChange, onScheduledActionsChange };
}

describe('CatalogDesigner', () => {
  it('edits action label and exposes SLA and search fields', async () => {
    const user = userEvent.setup();
    const { container, onActionsChange } = renderCatalog();
    expect(screen.getByRole('heading', { name: 'Catalog designer' })).toBeInTheDocument();
    const label = screen.getByLabelText('Label');
    await user.clear(label);
    await user.type(label, 'Finish');
    expect(onActionsChange).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'SLAs' }));
    expect(screen.getByLabelText('Target hours')).toHaveValue(24);
    await user.click(screen.getByRole('button', { name: 'Indexed fields' }));
    expect(screen.getByRole('heading', { name: 'Indexed fields' })).toBeInTheDocument();
    expect(screen.getByText('Built-in Find a case fields')).toBeInTheDocument();
    expect(screen.getByLabelText('Tracking ID match')).toBeInTheDocument();
    expect(screen.getByLabelText('Receipt number match')).toBeInTheDocument();
    expect(screen.getByLabelText('Stage match')).toBeInTheDocument();
    expect(screen.getByLabelText('Assignee match')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add indexed field' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Form field$/)).not.toBeInTheDocument();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('adds an extra Find a case criterion from a workload form field', async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    const onQueuesChange = vi.fn();
    function Harness() {
      const [search, setSearch] = useState({ searchKey: 'DEFAULT', fields: [] as [] });
      const [queues, setQueues] = useState({
        [demoDesignerQueue.queueKey]: demoDesignerQueue
      });
      return (
        <CatalogDesigner
          actions={{ [demoDesignerAction.actionKey]: demoDesignerAction }}
          queues={queues}
          slas={{ [demoDesignerSla.slaKey]: demoDesignerSla }}
          search={search}
          bulkActions={{ [demoDesignerBulk.bulkActionKey]: demoDesignerBulk }}
          scheduledActions={{ [demoDesignerScheduled.scheduledActionKey]: demoDesignerScheduled }}
          forms={{ [demoDesignerForm.formKey]: demoDesignerForm }}
          workflow={demoDesignerWorkflow}
          onActionsChange={vi.fn()}
          onQueuesChange={(next) => {
            onQueuesChange(next);
            setQueues(next);
          }}
          onSlasChange={vi.fn()}
          onSearchChange={(next) => {
            onSearchChange(next);
            setSearch(next as typeof search);
          }}
          onBulkActionsChange={vi.fn()}
          onScheduledActionsChange={vi.fn()}
        />
      );
    }
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Indexed fields' }));
    expect(screen.getByText(/No indexed form fields yet/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add indexed field' }));
    expect(onSearchChange).toHaveBeenCalled();
    const next = onSearchChange.mock.calls.at(-1)?.[0] as {
      fields: Array<{ fieldKey: string; path: string; source: string }>;
    };
    expect(next.fields[0]).toEqual(
      expect.objectContaining({
        source: 'BUSINESS_DATA',
        fieldKey: expect.any(String),
        path: expect.stringMatching(/^\$/)
      })
    );
    expect(onQueuesChange).toHaveBeenCalled();
    const queued = onQueuesChange.mock.calls.at(-1)?.[0] as Record<
      string,
      { projectedFields?: Array<{ path: string }> }
    >;
    expect(
      Object.values(queued).some((queue) =>
        (queue.projectedFields ?? []).some((field) => field.path === next.fields[0]?.path)
      )
    ).toBe(true);
    expect(screen.getByLabelText('Form field')).toBeInTheDocument();
    expect(screen.getByLabelText('Find a case')).toBeInTheDocument();
    expect(screen.getByLabelText('Dashboard')).toBeInTheDocument();
  });

  it('edits queue eligibility predicates', async () => {
    const user = userEvent.setup();
    const { container, onQueuesChange } = renderCatalog();
    await user.click(screen.getByRole('button', { name: 'Queues' }));
    expect(screen.getByLabelText('Queue entity type')).toHaveValue('WORKLOAD');
    await user.click(screen.getByText('Eligibility rules'));
    expect(screen.getByLabelText('Eligibility group')).toHaveValue('all');
    expect(screen.getByLabelText('all[0] value')).toHaveValue('READY_FOR_DATA_ENTRY');
    await user.clear(screen.getByLabelText('all[0] value'));
    await user.type(screen.getByLabelText('all[0] value'), 'COMPLETED');
    expect(onQueuesChange).toHaveBeenCalled();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('keeps commas while typing more queue columns', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [queues, setQueues] = useState<Record<string, QueueDefinition>>({
        [demoDesignerQueue.queueKey]: demoDesignerQueue
      });
      return (
        <CatalogDesigner
          actions={{ [demoDesignerAction.actionKey]: demoDesignerAction }}
          queues={queues}
          slas={{ [demoDesignerSla.slaKey]: demoDesignerSla }}
          search={demoDesignerSearch}
          bulkActions={{ [demoDesignerBulk.bulkActionKey]: demoDesignerBulk }}
          scheduledActions={{ [demoDesignerScheduled.scheduledActionKey]: demoDesignerScheduled }}
          stageKeys={['READY_FOR_DATA_ENTRY', 'COMPLETED']}
          transitionSetKeys={['FROM_DATA_ENTRY']}
          onActionsChange={vi.fn()}
          onQueuesChange={setQueues}
          onSlasChange={vi.fn()}
          onSearchChange={vi.fn()}
          onBulkActionsChange={vi.fn()}
          onScheduledActionsChange={vi.fn()}
        />
      );
    }
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Queues' }));
    const columns = screen.getByLabelText('Columns');
    expect(columns).toHaveValue('trackingId, assignedTo, receiptNumber');
    await user.click(columns);
    await user.keyboard('{End}, ageInQueue');
    expect(columns).toHaveValue('trackingId, assignedTo, receiptNumber, ageInQueue');
  });

  it('adds a projected form field from the form dropdown and appends it to columns', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [queues, setQueues] = useState<Record<string, QueueDefinition>>({
        [demoDesignerQueue.queueKey]: demoDesignerQueue
      });
      return (
        <CatalogDesigner
          actions={{ [demoDesignerAction.actionKey]: demoDesignerAction }}
          queues={queues}
          slas={{ [demoDesignerSla.slaKey]: demoDesignerSla }}
          search={demoDesignerSearch}
          bulkActions={{ [demoDesignerBulk.bulkActionKey]: demoDesignerBulk }}
          scheduledActions={{ [demoDesignerScheduled.scheduledActionKey]: demoDesignerScheduled }}
          forms={{ [demoDesignerForm.formKey]: demoDesignerForm }}
          stageKeys={['READY_FOR_DATA_ENTRY', 'COMPLETED']}
          transitionSetKeys={['FROM_DATA_ENTRY']}
          onActionsChange={vi.fn()}
          onQueuesChange={setQueues}
          onSlasChange={vi.fn()}
          onSearchChange={vi.fn()}
          onBulkActionsChange={vi.fn()}
          onScheduledActionsChange={vi.fn()}
        />
      );
    }
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Queues' }));
    await user.click(screen.getByRole('button', { name: 'Add form field' }));
    const formField = screen.getByLabelText('Form field 1');
    expect(formField).toHaveValue('$.dataEntryDetails.ANumber');
    expect(screen.getByLabelText('Column label 1')).toHaveValue('A-Number');
    expect(screen.getByLabelText('Columns')).toHaveValue('trackingId, assignedTo, receiptNumber, A_NUMBER');
    await user.selectOptions(formField, '$.dataEntryDetails.receiptNumber');
    expect(screen.getByLabelText('Column label 1')).toHaveValue('Receipt Number');
    expect(screen.getByLabelText('Columns')).toHaveValue('trackingId, assignedTo, receiptNumber, RECEIPT_NUMBER');
  });

  it('gives a new queue the definition entity type', async () => {
    const user = userEvent.setup();
    const { onQueuesChange } = renderCatalog({ defaultEntityType: 'MAIL' });
    await user.click(screen.getByRole('button', { name: 'Queues' }));
    await user.click(screen.getByRole('button', { name: 'Add queue' }));
    const created = onQueuesChange.mock.calls.at(-1)?.[0] as Record<string, { entityType?: string }>;
    expect(created.QUEUE?.entityType).toBe('MAIL');
  });

  it('edits bulk and scheduled catalog entries', async () => {
    const user = userEvent.setup();
    const { onBulkActionsChange, onScheduledActionsChange } = renderCatalog();
    await user.click(screen.getByRole('button', { name: 'Bulk' }));
    expect(screen.getByLabelText('Bulk action key')).toHaveValue('BULK_COMPLETE');
    expect(screen.getByLabelText('Max selection')).toHaveValue(25);
    expect(screen.getByLabelText('Transaction mode')).toHaveValue('BEST_EFFORT');
    await user.clear(screen.getByLabelText('Max selection'));
    await user.type(screen.getByLabelText('Max selection'), '10');
    expect(onBulkActionsChange).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Scheduled' }));
    expect(screen.getByLabelText('Scheduled action key')).toHaveValue('ON_HOLD_NUDGE');
    expect(screen.getByLabelText('Delay source')).toHaveValue('CONFIG');
    expect(screen.getByLabelText('Action type')).toHaveValue('NOTIFICATION');
    await user.selectOptions(screen.getByLabelText('Delay source'), 'FIELD');
    expect(onScheduledActionsChange).toHaveBeenCalled();
  });

  it('picks transition sets and workflow stages from dropdowns', async () => {
    const user = userEvent.setup();
    const { onActionsChange, onBulkActionsChange } = renderCatalog();
    expect(screen.getByLabelText('Transition set')).toHaveValue('FROM_DATA_ENTRY');
    await user.selectOptions(screen.getByLabelText('Transition set'), 'FROM_REVIEW');
    expect(onActionsChange).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Bulk' }));
    expect(screen.getByLabelText('Stage')).toHaveValue('READY_FOR_DATA_ENTRY');
    expect(screen.getByLabelText('Target stage')).toHaveValue('COMPLETED');
    await user.selectOptions(screen.getByLabelText('Stage'), 'COMPLETED');
    expect(onBulkActionsChange).toHaveBeenCalled();
  });

  it('shows an empty-state CTA when there are no actions', async () => {
    const user = userEvent.setup();
    const onActionsChange = vi.fn();
    renderCatalog({ actions: {}, onActionsChange });
    expect(screen.getByText('No actions yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add action' }));
    expect(onActionsChange).toHaveBeenCalled();
  });

  it('uses a list and detail pane for actions', async () => {
    const user = userEvent.setup();
    renderCatalog();
    expect(screen.getByRole('heading', { level: 2, name: 'Actions' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Actions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Complete/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/TRANSITION actions must point/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Queues' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Queues' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Queues' })).toBeInTheDocument();
  });

  it('lists queues in workflow stage order', async () => {
    const user = userEvent.setup();
    const later = {
      ...demoDesignerQueue,
      queueKey: 'REVIEW_QUEUE',
      displayName: 'Review'
    };
    const earlier = {
      ...demoDesignerQueue,
      queueKey: 'INTAKE_QUEUE',
      displayName: 'Intake'
    };
    const orphan = {
      ...demoDesignerQueue,
      queueKey: 'UNUSED_QUEUE',
      displayName: 'Unused'
    };
    renderCatalog({
      queues: {
        UNUSED_QUEUE: orphan,
        REVIEW_QUEUE: later,
        INTAKE_QUEUE: earlier
      },
      workflow: {
        ...demoDesignerWorkflow,
        stages: [
          {
            ...demoDesignerWorkflow.stages[0]!,
            order: 5,
            queueKey: 'INTAKE_QUEUE'
          },
          {
            ...demoDesignerWorkflow.stages[0]!,
            stageKey: 'READY_FOR_REVIEW',
            displayName: 'Ready for Review',
            order: 20,
            queueKey: 'REVIEW_QUEUE'
          },
          demoDesignerWorkflow.stages[1]!
        ]
      }
    });
    await user.click(screen.getByRole('button', { name: 'Queues' }));
    const list = screen.getByRole('complementary', { name: 'Queues' });
    const titles = [...list.querySelectorAll('button strong')].map((node) => node.textContent);
    expect(titles).toEqual(['Intake', 'Review', 'Unused']);
  });

  it('deletes the selected action after confirmation', async () => {
    const user = userEvent.setup();
    const onDeleteAction = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderCatalog({ onDeleteAction });
    await user.click(screen.getByRole('button', { name: 'Delete Action' }));
    expect(window.confirm).toHaveBeenCalled();
    expect(onDeleteAction).toHaveBeenCalledWith('COMPLETE');
  });
});
