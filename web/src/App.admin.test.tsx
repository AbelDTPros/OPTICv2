import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';
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
    expect(document.title).toBe('OPTIC NextGen — Admin');
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
});
