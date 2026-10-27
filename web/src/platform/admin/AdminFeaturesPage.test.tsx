import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { FeatureFlagsProvider } from '../features/FeatureFlagsContext.js';
import * as featureApi from '../features/feature-api.js';
import { AdminFeaturesPage } from './AdminFeaturesPage.js';

describe('AdminFeaturesPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(featureApi, 'fetchEffectiveFeatures').mockResolvedValue({
      flags: { 'ui.shell.designer': true },
      admin: { uiEnabled: true, apiEnabled: true }
    });
  });

  it('lists flags by group and toggles a feature', async () => {
    const user = userEvent.setup();
    vi.spyOn(featureApi, 'listAdminFeatures').mockResolvedValue({
      admin: { uiEnabled: true, apiEnabled: true },
      flags: [
        {
          key: 'ui.shell.designer',
          label: 'Designer',
          enabled: true,
          description: 'Configuration Designer in the primary navigation.',
          rowVersion: 1,
          updatedAt: '2026-01-01T00:00:00.000Z',
          updatedBy: 'system',
          group: 'shell'
        }
      ]
    });
    vi.spyOn(featureApi, 'updateAdminFeature').mockResolvedValue({
      key: 'ui.shell.designer',
      label: 'Designer',
      enabled: false,
      description: 'Configuration Designer in the primary navigation.',
      rowVersion: 2,
      updatedAt: '2026-01-01T00:00:01.000Z',
      updatedBy: 'admin@example.gov',
      group: 'shell'
    });

    const { container } = render(
      <FeatureFlagsProvider>
        <AdminFeaturesPage />
      </FeatureFlagsProvider>
    );

    await waitFor(() => expect(screen.getByText('Designer')).toBeInTheDocument());
    expect(screen.getByText('ui.shell.designer')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Navigation' })).toBeInTheDocument();
    const toggle = screen.getByRole('switch', { name: 'Designer' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.click(toggle);
    await waitFor(() => expect(featureApi.updateAdminFeature).toHaveBeenCalledWith('ui.shell.designer', {
      enabled: false,
      expectedRowVersion: 1
    }));
    expect(await screen.findByRole('switch', { name: 'Designer' })).toHaveAttribute('aria-checked', 'false');
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
