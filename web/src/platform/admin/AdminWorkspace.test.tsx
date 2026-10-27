import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeatureFlagsProvider } from '../features/FeatureFlagsContext.js';
import * as featureApi from '../features/feature-api.js';
import * as auditApi from './audit-api.js';
import { AdminWorkspace } from './AdminWorkspace.js';

describe('AdminWorkspace', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(featureApi, 'fetchEffectiveFeatures').mockResolvedValue({
      flags: {},
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
  });

  it('navigates Admin sections from the left menubar', async () => {
    const user = userEvent.setup();
    render(
      <FeatureFlagsProvider>
        <AdminWorkspace />
      </FeatureFlagsProvider>
    );

    const nav = screen.getByRole('navigation', { name: 'Admin sections' });
    expect(nav).toHaveTextContent('Features');
    expect(nav).toHaveTextContent('Audit trail');
    expect(nav).toHaveTextContent('Integrations');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Product features' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Audit trail' }));
    expect(screen.getByRole('heading', { name: 'Audit trail' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply filters' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset audit filters' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Integrations' }));
    expect(screen.getByRole('heading', { name: 'Integrations' })).toBeInTheDocument();
    expect(screen.getByText(/Coming next/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Features' }));
    expect(screen.getByRole('heading', { name: 'Product features' })).toBeInTheDocument();
  });
});
