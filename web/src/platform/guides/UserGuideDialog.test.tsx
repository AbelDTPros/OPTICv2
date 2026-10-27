import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UserGuideDialog } from './UserGuideDialog.js';

describe('UserGuideDialog', () => {
  it('renders markdown headings and closes', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <UserGuideDialog
        title="Officer Workspace user guide"
        source={'# Officer Workspace user guide\n\n## Pick a workload type\n\nUse **Live** queues.'}
        onClose={onClose}
      />
    );
    expect(screen.getByRole('dialog', { name: 'Officer Workspace user guide' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pick a workload type' })).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close user guide' }));
    expect(onClose).toHaveBeenCalled();
  });
});
