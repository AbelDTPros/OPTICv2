import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CommandPalette } from './CommandPalette.js';

describe('CommandPalette', () => {
  it('filters and runs a command', async () => {
    const user = userEvent.setup();
    const runWorkspace = vi.fn();
    const runDesigner = vi.fn();
    render(
      <CommandPalette
        open
        onClose={() => undefined}
        commands={[
          { id: 'workspace', label: 'Go to Workspace', hint: 'Queues', run: runWorkspace },
          { id: 'designer', label: 'Go to Designer', hint: 'Author', run: runDesigner }
        ]}
      />
    );
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Jump to…'), 'design');
    expect(screen.queryByRole('option', { name: /Go to Workspace/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Go to Designer/i }));
    expect(runDesigner).toHaveBeenCalledTimes(1);
    expect(runWorkspace).not.toHaveBeenCalled();
  });
});
