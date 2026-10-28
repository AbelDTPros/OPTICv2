import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { App } from './App.js';
import { SHELL_NAV_ORDER_KEY } from './platform/shell/shell-nav-order.js';

function stubLocalStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    }
  });
}

describe('App', () => {
  beforeEach(() => {
    stubLocalStorage();
  });

  it('exposes a skip link, unique page title, and has no automated accessibility violations', async () => {
    const { container } = render(<App />);
    expect(document.title).toBe('OPTIC 2.0 — Workspace');
    const skip = screen.getByRole('link', { name: 'Skip to main content' });
    expect(skip).toHaveAttribute('href', '#optic-main');
    expect(document.getElementById('optic-main')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(nav).toHaveTextContent('Workspace');
    expect(nav).toHaveTextContent('Designer');
    expect(nav).not.toHaveTextContent('Live queue');
    expect(nav).not.toHaveTextContent('Form');
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('opens on the leftmost saved primary destination', () => {
    stubLocalStorage({
      [SHELL_NAV_ORDER_KEY]: JSON.stringify(['supervisor', 'workspace', 'designer', 'admin'])
    });
    render(<App />);
    expect(document.title).toBe('OPTIC 2.0 — Dashboard');
    expect(screen.getByRole('button', { name: 'Dashboard', current: 'page' })).toBeInTheDocument();
  });

  it('updates the document title when switching to Designer', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Designer' }));
    expect(document.title).toBe('OPTIC 2.0 — Designer');
    expect(screen.getByRole('heading', { name: 'Form designer' })).toBeInTheDocument();
  });

  it('opens the command palette from Jump to…', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Jump to…/i }));
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Go to Designer/i }));
    expect(document.title).toBe('OPTIC 2.0 — Designer');
  });
});
