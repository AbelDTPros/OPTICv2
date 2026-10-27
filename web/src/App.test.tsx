import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { App } from './App.js';

describe('App', () => {
  it('exposes a skip link, unique page title, and has no automated accessibility violations', async () => {
    const { container } = render(<App />);
    expect(document.title).toBe('OPTIC NextGen — Workspace');
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

  it('updates the document title when switching to Designer', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Designer' }));
    expect(document.title).toBe('OPTIC NextGen — Designer');
    expect(screen.getByRole('heading', { name: 'Form designer' })).toBeInTheDocument();
  });
});
