import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { demoQueuePage } from './demo-queue.js';
import { QueueScreen } from './QueueScreen.js';

describe('QueueScreen', () => {
  it('renders configured columns, assignment text, and has no automated accessibility violations', async () => {
    const { container } = render(<QueueScreen queue={demoQueuePage} actorId="officer@example.gov" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Ready for Data Entry' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: /Ready for Data Entry queue/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Row' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Tracking ID' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Assigned to' })).toBeInTheDocument();
    expect(screen.getByText('W-2001')).toBeInTheDocument();
    const rows = screen.getAllByRole('row');
    expect(rows[1]).toHaveTextContent(/^1/);
    expect(rows[2]).toHaveTextContent(/^2/);
    expect(screen.getAllByText('Unassigned').length).toBeGreaterThan(0);
    expect(screen.getByText('officer@example.gov')).toBeInTheDocument();
    expect(screen.getByLabelText('Assignment')).toBeInTheDocument();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('underlines the open queue row', () => {
    render(
      <QueueScreen queue={demoQueuePage} actorId="officer@example.gov" onOpen={vi.fn()} openTrackingId="W-2002" />
    );
    const openRow = screen.getByRole('row', { name: /W-2002/ });
    expect(openRow).toHaveClass('optic-queue-row-open');
    expect(openRow).toHaveAttribute('aria-current', 'true');
  });

  it('opens a row already assigned to the officer from the Open action', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<QueueScreen queue={demoQueuePage} actorId="officer@example.gov" onOpen={onOpen} />);
    await user.click(screen.getByRole('button', { name: 'Open W-2002' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ trackingId: 'W-2002' }));
  });

  it('opens an unassigned row from the tracking id control', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<QueueScreen queue={demoQueuePage} actorId="officer@example.gov" onOpen={onOpen} />);
    await user.click(screen.getByRole('button', { name: 'W-2001' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ trackingId: 'W-2001' }));
  });

  it('opens from a mouse click on the row body without making the row a tab stop', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<QueueScreen queue={demoQueuePage} actorId="officer@example.gov" onOpen={onOpen} />);
    const row = screen.getByRole('row', { name: /W-2002/ });
    expect(row).not.toHaveAttribute('tabindex');
    await user.click(row);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ trackingId: 'W-2002' }));
  });

  it('does not open the row when an assignment action is clicked', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onAssign = vi.fn();
    render(
      <QueueScreen
        queue={demoQueuePage}
        actorId="officer@example.gov"
        onOpen={onOpen}
        onAssign={onAssign}
      />
    );
    await user.click(screen.getAllByRole('button', { name: 'Assign to me' })[0]!);
    expect(onAssign).toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('invokes assign only for an unassigned row', async () => {
    const user = userEvent.setup();
    const onAssign = vi.fn();
    render(<QueueScreen queue={demoQueuePage} actorId="officer@example.gov" onAssign={onAssign} />);
    const assignButtons = screen.getAllByRole('button', { name: 'Assign to me' });
    const unassigned = assignButtons[0];
    const assigned = assignButtons[1];
    expect(unassigned).toBeDefined();
    expect(assigned).toBeDefined();
    expect(unassigned).toBeEnabled();
    expect(assigned).toBeDisabled();
    await user.click(unassigned!);
    expect(onAssign).toHaveBeenCalledWith(expect.objectContaining({ trackingId: 'W-2001', rowVersion: 0 }));
  });

  it('asks who should receive the case before reassigning', async () => {
    const user = userEvent.setup();
    const onReassign = vi.fn();
    const { container } = render(
      <QueueScreen queue={demoQueuePage} actorId="officer@example.gov" onReassign={onReassign} />
    );
    await user.click(screen.getByRole('button', { name: 'Reassign W-2001' }));
    const dialog = screen.getByRole('dialog', { name: 'Reassign W-2001' });
    expect(dialog).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Reassign to'), 'Jordan Lee');
    await user.click(within(dialog).getByRole('button', { name: 'Reassign' }));
    expect(onReassign).toHaveBeenCalledWith(expect.objectContaining({ trackingId: 'W-2001' }), 'Jordan Lee');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('does not offer assign or reassign on a completed row', () => {
    const completedPage = {
      ...demoQueuePage,
      rows: [
        {
          ...demoQueuePage.rows[0]!,
          trackingId: 'W-2099',
          currentStageKey: 'COMPLETED',
          status: 'COMPLETED',
          assignedTo: 'officer@example.gov',
          assignedStatus: 'ASSIGNED' as const,
          values: { ...demoQueuePage.rows[0]!.values, trackingId: 'W-2099' }
        }
      ]
    };
    render(
      <QueueScreen
        queue={completedPage}
        actorId="officer@example.gov"
        onAssign={vi.fn()}
        onReassign={vi.fn()}
        onOpen={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: 'Assign to me' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reassign W-2099' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open W-2099' })).toBeInTheDocument();
  });

  it('hides assign, reassign, and release when the stage policy forbids them', () => {
    const lockedPage = {
      ...demoQueuePage,
      rows: [
        {
          ...demoQueuePage.rows[1]!,
          allowAssign: false,
          allowReassign: false,
          allowRelease: false
        }
      ]
    };
    render(
      <QueueScreen
        queue={lockedPage}
        actorId="officer@example.gov"
        onAssign={vi.fn()}
        onRelease={vi.fn()}
        onReassign={vi.fn()}
        onOpen={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: 'Assign to me' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reassign W-2002' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Release' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open W-2002' })).toBeInTheDocument();
  });

  it('runs a configured bulk action against selected rows', async () => {
    const user = userEvent.setup();
    const onBulkExecute = vi.fn();
    render(
      <QueueScreen queue={demoQueuePage} actorId="officer@example.gov" onBulkExecute={onBulkExecute} />
    );
    await user.click(screen.getByLabelText('Select W-2001'));
    await user.type(screen.getByLabelText(/Ship date/), '2026-08-23');
    await user.click(screen.getByRole('button', { name: 'Ship Selected' }));
    expect(onBulkExecute).toHaveBeenCalledWith(
      expect.objectContaining({ bulkActionKey: 'BULK_SHIP' }),
      [expect.objectContaining({ trackingId: 'W-2001' })],
      { shipDate: '2026-08-23' }
    );
  });

  it('announces an error summary when assignment fails', () => {
    render(
      <QueueScreen
        queue={demoQueuePage}
        errorSummary="This item changed after you opened it. Refresh and try again."
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('This item changed after you opened it');
  });
});
