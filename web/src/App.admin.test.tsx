import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';
import * as auditApi from './platform/admin/audit-api.js';
import * as featureApi from './platform/features/feature-api.js';

describe('App admin gate', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows Admin nav when FEATURE_ADMIN_UI is enabled via /features', async () => {
    const user = userEvent.setup();
    vi.spyOn(featureApi, 'fetchEffectiveFeatures').mockResolvedValue({
      flags: {
        'ui.shell.workspace': true,
        'ui.shell.designer': true
      },
      admin: { uiEnabled: true, apiEnabled: true }
    });
    vi.spyOn(featureApi, 'listAdminFeatures').mockResolvedValue({
      admin: { uiEnabled: true, apiEnabled: true },
      flags: []
    });

    render(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Admin' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Admin' }));
    expect(document.title).toBe('OPTIC 2.0 — Admin');
    expect(screen.getByRole('navigation', { name: 'Admin sections' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Product features' })).toBeInTheDocument();
  });

  it('hides Admin nav when FEATURE_ADMIN_UI is disabled', async () => {
    vi.spyOn(featureApi, 'fetchEffectiveFeatures').mockResolvedValue({
      flags: {
        'ui.shell.workspace': true,
        'ui.shell.designer': true
      },
      admin: { uiEnabled: false, apiEnabled: false }
    });

    render(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Workspace' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Admin' })).not.toBeInTheDocument();
  });

  it('omits disabled surfaces from the command palette', async () => {
    const user = userEvent.setup();
    vi.spyOn(featureApi, 'fetchEffectiveFeatures').mockResolvedValue({
      flags: {
        'ui.shell.workspace': true,
        'ui.shell.designer': false,
        'ui.shell.supervisor': false,
        'ui.shell.command_palette': true,
        'ui.workspace.search': false,
        'api.search': false,
        'ui.designer.try': false,
        'ui.designer.lifecycle': false
      },
      admin: { uiEnabled: false, apiEnabled: false }
    });

    render(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Workspace' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Jump to…/i }));
    expect(screen.getByRole('button', { name: /Go to Workspace/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Go to Designer/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Go to Dashboard/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Go to Admin/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Admin ·/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Find a case/i })).not.toBeInTheDocument();
  });

  it('hides Jump to… when the command palette flag is off', async () => {
    vi.spyOn(featureApi, 'fetchEffectiveFeatures').mockResolvedValue({
      flags: {
        'ui.shell.workspace': true,
        'ui.shell.command_palette': false
      },
      admin: { uiEnabled: true, apiEnabled: true }
    });

    render(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Workspace' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Jump to…/i })).not.toBeInTheDocument();
  });

  it('includes Admin sections in Jump to…', async () => {
    const user = userEvent.setup();
    vi.spyOn(featureApi, 'fetchEffectiveFeatures').mockResolvedValue({
      flags: {
        'ui.shell.workspace': true,
        'ui.shell.designer': true
      },
      admin: { uiEnabled: true, apiEnabled: true }
    });
    vi.spyOn(featureApi, 'listAdminFeatures').mockResolvedValue({
      admin: { uiEnabled: true, apiEnabled: true },
      flags: []
    });
    vi.spyOn(auditApi, 'listAdminAudit').mockResolvedValue({
      admin: { uiEnabled: true, apiEnabled: true },
      page: 1,
      pageSize: 25,
      total: 0,
      totalPages: 0,
      items: []
    });
    vi.spyOn(auditApi, 'getAdminAuditFilterOptions').mockResolvedValue({
      admin: { uiEnabled: true, apiEnabled: true },
      actors: [],
      definitionKeys: []
    });

    render(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Admin' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Jump to…/i }));
    expect(screen.getByRole('button', { name: /Go to Admin/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Admin · Features/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Admin · Audit trail/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Admin · Integrations/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Admin · Audit trail/i }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Audit trail' })).toBeInTheDocument()
    );
  });
});
