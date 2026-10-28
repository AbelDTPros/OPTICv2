import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrimaryShellNav } from './PrimaryShellNav.js';
import { SHELL_NAV_ORDER_KEY } from './shell-nav-order.js';

describe('PrimaryShellNav', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(),
      length: 0
    });
  });

  it('reorders focused items with Alt+Arrow keys and persists the preference', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <PrimaryShellNav
        enabled={{
          workspace: true,
          supervisor: true,
          designer: true,
          admin: true
        }}
        currentView="workspace"
        onSelect={onSelect}
      />
    );

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    const workspace = within(nav).getByRole('button', { name: 'Workspace' });
    workspace.focus();
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}');

    const buttons = within(nav).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Dashboard',
      'Workspace',
      'Designer',
      'Admin'
    ]);
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      SHELL_NAV_ORDER_KEY,
      JSON.stringify(['supervisor', 'workspace', 'designer', 'admin'])
    );
    expect(screen.getByRole('status')).toHaveTextContent(/Workspace moved to position 2/i);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('omits disabled destinations from the bar', () => {
    render(
      <PrimaryShellNav
        enabled={{
          workspace: true,
          supervisor: false,
          designer: true,
          admin: false
        }}
        currentView="workspace"
        onSelect={() => undefined}
      />
    );
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getByRole('button', { name: 'Workspace' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'Designer' })).toBeInTheDocument();
    expect(within(nav).queryByRole('button', { name: 'Dashboard' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('button', { name: 'Admin' })).not.toBeInTheDocument();
  });
});
