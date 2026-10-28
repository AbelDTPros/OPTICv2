import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as configApi from '../designers/config-api.js';
import { FeatureFlagsProvider } from '../features/FeatureFlagsContext.js';
import * as featureApi from '../features/feature-api.js';
import * as dashboardApi from './dashboard-api.js';
import { SupervisorWorkspace } from './SupervisorWorkspace.js';

function stubLocalStorage(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
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

describe('SupervisorWorkspace', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    stubLocalStorage();
    vi.spyOn(featureApi, 'fetchEffectiveFeatures').mockResolvedValue({
      flags: {},
      admin: { uiEnabled: true, apiEnabled: true }
    });
    vi.spyOn(configApi, 'listDefinitions').mockResolvedValue([
      { definitionKey: 'I_407_MAILITEM', displayName: 'I-407 Mail', entityType: 'MAIL' },
      { definitionKey: 'I_407_WORKLOAD', displayName: 'I-407 Workload', entityType: 'WORKLOAD' }
    ]);
    vi.spyOn(configApi, 'listReleaseCatalog').mockResolvedValue([
      {
        definitionKey: 'I_407_MAILITEM',
        displayName: 'I-407 Mail',
        version: '0.1.0',
        lifecycleStatus: 'PUBLISHED',
        active: true
      },
      {
        definitionKey: 'I_407_WORKLOAD',
        displayName: 'I-407 Workload',
        version: '0.1.0',
        lifecycleStatus: 'PUBLISHED',
        active: true
      }
    ]);
    vi.spyOn(dashboardApi, 'fetchSupervisorDashboard').mockResolvedValue({
      definitionKeys: ['I_407_MAILITEM', 'I_407_WORKLOAD'],
      asOf: '2026-10-23T18:00:00.000Z',
      dimensions: [],
      appliedFilters: {},
      kpis: { loggedToday: 5, openBacklog: 12, pastSla: 3 },
      stages: [
        {
          stageKey: 'DATA_ENTRY',
          displayName: 'Data entry',
          count: 8,
          oldestEnteredStageAt: '2026-10-20T00:00:00.000Z',
          oldestAgeMinutes: 4320,
          lateCount: 2
        }
      ],
      pressure: [
        {
          stageKey: 'DATA_ENTRY',
          displayName: 'Data entry',
          lateCount: 2,
          oldestAgeMinutes: 4320,
          count: 8
        }
      ],
      assignees: [
        {
          assignedTo: null,
          label: 'Unassigned',
          count: 4,
          lateCount: 2,
          oldestAgeMinutes: 4320,
          cases: [
            {
              trackingId: 'W-LATE000001',
              entityType: 'WORKLOAD',
              definitionKey: 'I_407_WORKLOAD',
              stageKey: 'DATA_ENTRY',
              stageDisplayName: 'Data entry',
              assignedTo: null,
              ageMinutes: 4320,
              pastSla: true
            }
          ]
        },
        {
          assignedTo: 'officer.a@example.gov',
          label: 'officer.a@example.gov',
          count: 8,
          lateCount: 1,
          oldestAgeMinutes: 120,
          cases: [
            {
              trackingId: 'W-ASSIGNED01',
              entityType: 'WORKLOAD',
              definitionKey: 'I_407_WORKLOAD',
              stageKey: 'DATA_ENTRY',
              stageDisplayName: 'Data entry',
              assignedTo: 'officer.a@example.gov',
              ageMinutes: 120,
              pastSla: false
            }
          ]
        }
      ],
      actionQueue: [
        {
          trackingId: 'W-LATE000001',
          entityType: 'WORKLOAD',
          definitionKey: 'I_407_WORKLOAD',
          stageKey: 'DATA_ENTRY',
          stageDisplayName: 'Data entry',
          assignedTo: null,
          ageMinutes: 4320,
          pastSla: true
        }
      ],
      recentActivity: [
        {
          eventId: 'e1',
          eventType: 'WORKLOAD_ASSIGNED',
          occurredAt: '2026-10-23T17:00:00.000Z',
          actorId: 'supervisor@example.gov',
          actorName: 'Supervisor',
          entityType: 'WORKLOAD',
          entityTrackingId: 'W-ABC1234567',
          definitionKey: 'I_407_WORKLOAD',
          stageKey: 'DATA_ENTRY',
          summary: 'Supervisor claimed W-ABC1234567.'
        }
      ]
    });
  });

  it('loads KPIs after a workload type is selected', async () => {
    const user = userEvent.setup();
    render(
      <FeatureFlagsProvider>
        <SupervisorWorkspace />
      </FeatureFlagsProvider>
    );

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Choose a workload type' })).toBeInTheDocument();

    const combobox = screen.getByRole('combobox', { name: 'Workload Type' });
    await user.click(combobox);
    await user.click(await screen.findByRole('option', { name: /I-407/i }));

    await waitFor(() => expect(dashboardApi.fetchSupervisorDashboard).toHaveBeenCalled());
    expect(screen.getByText('Logged today')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Logged today 5 Open Workspace' })).toHaveTextContent(
      '5'
    );
    expect(screen.getByText('Open backlog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open backlog 12 Open Workspace' })).toHaveTextContent(
      '12'
    );
    expect(screen.getByRole('heading', { name: 'Needs attention' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Show late cases/i })).toHaveTextContent(/Needs attention/i);
    expect(screen.getByText('W-LATE000001')).toBeInTheDocument();
    const assigneeSection = screen.getByRole('heading', { name: 'By assignee' }).closest('section');
    expect(assigneeSection).toBeTruthy();
    expect(within(assigneeSection as HTMLElement).getByRole('button', { name: /Unassigned/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Data entry' })).toBeInTheDocument();
    expect(screen.getByText(/Supervisor claimed/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Where the pressure is' })).toBeInTheDocument();
    expect(screen.getByText(/As of/i)).toBeInTheDocument();
    expect(window.localStorage.getItem('optic.workloadType.kindKey')).toBe('I_407');

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    });

    await user.click(screen.getByRole('button', { name: 'W-ABC1234567' }));
    const casePanel = screen.getByRole('complementary', { name: 'Opened case' });
    expect(casePanel).toHaveTextContent('W-ABC1234567');

    await user.click(
      within(casePanel).getByRole('button', { name: 'Copy tracking id W-ABC1234567' })
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('W-ABC1234567'));
    expect(within(casePanel).getByRole('button', { name: 'Copied W-ABC1234567' })).toBeInTheDocument();
  });

  it('clears the selected workload type', async () => {
    const user = userEvent.setup();
    render(
      <FeatureFlagsProvider>
        <SupervisorWorkspace />
      </FeatureFlagsProvider>
    );
    const combobox = await screen.findByRole('combobox', { name: 'Workload Type' });
    await user.click(combobox);
    await user.click(await screen.findByRole('option', { name: /I-407/i }));
    await waitFor(() => expect(dashboardApi.fetchSupervisorDashboard).toHaveBeenCalled());
    expect(screen.getByRole('heading', { name: 'Needs attention' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear workload type' }));
    expect(combobox).toHaveDisplayValue('');
    expect(screen.queryByRole('heading', { name: 'Needs attention' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Choose a workload type' })).toBeInTheDocument();
    expect(window.localStorage.getItem('optic.workloadType.kindKey')).toBeNull();
  });

  it('restores the last selected workload type', async () => {
    stubLocalStorage({ 'optic.workloadType.kindKey': 'I_407' });
    render(
      <FeatureFlagsProvider>
        <SupervisorWorkspace />
      </FeatureFlagsProvider>
    );
    await waitFor(() => expect(dashboardApi.fetchSupervisorDashboard).toHaveBeenCalled());
    expect(screen.getByRole('heading', { name: 'Needs attention' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Workload Type' })).toHaveDisplayValue(/I-407/i);
  });

  it('hides and restores dashboard tiles from Arrange', async () => {
    const user = userEvent.setup();
    render(
      <FeatureFlagsProvider>
        <SupervisorWorkspace />
      </FeatureFlagsProvider>
    );
    const combobox = await screen.findByRole('combobox', { name: 'Workload Type' });
    await user.click(combobox);
    await user.click(await screen.findByRole('option', { name: /I-407/i }));
    await waitFor(() => expect(dashboardApi.fetchSupervisorDashboard).toHaveBeenCalled());
    expect(screen.getByRole('heading', { name: 'Recent activity' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Needs attention' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Arrange dashboard' }));
    await user.click(screen.getByRole('checkbox', { name: 'Show Recent activity' }));
    await user.click(screen.getByRole('checkbox', { name: 'Show Needs attention' }));
    expect(screen.queryByRole('heading', { name: 'Recent activity' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Needs attention' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Logged today 5 Open Workspace' })).toBeInTheDocument();

    const saved = window.localStorage.getItem('optic.supervisor.layout.officer@example.gov') ?? '';
    expect(saved).toContain('"activity":false');
    expect(saved).toContain('"left"');
    expect(saved).toContain('"right"');

    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByRole('heading', { name: 'Recent activity' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Needs attention' })).toBeInTheDocument();
  });

  it('restores focus to Arrange after closing the layout dialog', async () => {
    const user = userEvent.setup();
    render(
      <FeatureFlagsProvider>
        <SupervisorWorkspace />
      </FeatureFlagsProvider>
    );
    const combobox = await screen.findByRole('combobox', { name: 'Workload Type' });
    await user.click(combobox);
    await user.click(await screen.findByRole('option', { name: /I-407/i }));
    await waitFor(() => expect(dashboardApi.fetchSupervisorDashboard).toHaveBeenCalled());

    const arrange = screen.getByRole('button', { name: 'Arrange dashboard' });
    await user.click(arrange);
    expect(screen.getByRole('dialog', { name: 'Layout' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Layout' })).not.toBeInTheDocument();
    expect(arrange).toHaveFocus();
  });

  it('moves a tile with the Rearrange menu for keyboard users', async () => {
    const user = userEvent.setup();
    render(
      <FeatureFlagsProvider>
        <SupervisorWorkspace />
      </FeatureFlagsProvider>
    );
    const combobox = await screen.findByRole('combobox', { name: 'Workload Type' });
    await user.click(combobox);
    await user.click(await screen.findByRole('option', { name: /I-407/i }));
    await waitFor(() => expect(dashboardApi.fetchSupervisorDashboard).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'Rearrange Needs attention' }));
    const menu = screen.getByRole('menu', { name: 'Move Needs attention' });
    await user.click(within(menu).getByRole('menuitem', { name: 'Move to right column' }));
    expect(screen.getByText(/Needs attention moved to right column/i)).toBeInTheDocument();

    const saved = window.localStorage.getItem('optic.supervisor.layout.officer@example.gov') ?? '';
    const parsed = JSON.parse(saved) as { left: string[]; right: string[] };
    expect(parsed.left).not.toContain('attention');
    expect(parsed.right).toContain('attention');
  });

  it('filters the attention list from Past SLA', async () => {
    const user = userEvent.setup();
    render(
      <FeatureFlagsProvider>
        <SupervisorWorkspace />
      </FeatureFlagsProvider>
    );
    const combobox = await screen.findByRole('combobox', { name: 'Workload Type' });
    await user.click(combobox);
    await user.click(await screen.findByRole('option', { name: /I-407/i }));
    await waitFor(() => expect(dashboardApi.fetchSupervisorDashboard).toHaveBeenCalled());
    await user.click(await screen.findByRole('button', { name: /Show late cases/i }));
    expect(screen.getByRole('heading', { name: 'Past SLA' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Clear filter/i })).toBeInTheDocument();
  });

  it('paginates the Needs attention list', async () => {
    vi.spyOn(dashboardApi, 'fetchSupervisorDashboard').mockResolvedValue({
      definitionKeys: ['I_407_WORKLOAD'],
      asOf: '2026-10-23T18:00:00.000Z',
      dimensions: [],
      appliedFilters: {},
      kpis: { loggedToday: 5, openBacklog: 12, pastSla: 2 },
      stages: [
        {
          stageKey: 'DATA_ENTRY',
          displayName: 'Data entry',
          count: 8,
          oldestEnteredStageAt: '2026-10-20T12:00:00.000Z',
          oldestAgeMinutes: 4320,
          lateCount: 2
        }
      ],
      pressure: [],
      assignees: [],
      actionQueue: Array.from({ length: 7 }, (_, index) => ({
        trackingId: `W-ATT${String(index + 1).padStart(7, '0')}`,
        entityType: 'WORKLOAD',
        definitionKey: 'I_407_WORKLOAD',
        stageKey: 'DATA_ENTRY',
        stageDisplayName: 'Data entry',
        assignedTo: null,
        ageMinutes: 100 - index,
        pastSla: index < 2
      })),
      recentActivity: []
    });

    const user = userEvent.setup();
    render(
      <FeatureFlagsProvider>
        <SupervisorWorkspace />
      </FeatureFlagsProvider>
    );
    const combobox = await screen.findByRole('combobox', { name: 'Workload Type' });
    await user.click(combobox);
    await user.click(await screen.findByRole('option', { name: /I-407/i }));
    await waitFor(() => expect(dashboardApi.fetchSupervisorDashboard).toHaveBeenCalled());

    const pageSize = screen.getByRole('combobox', { name: 'Needs attention rows per page' });
    await user.selectOptions(pageSize, '5');

    expect(screen.getByText('W-ATT0000001')).toBeInTheDocument();
    expect(screen.getByText('W-ATT0000005')).toBeInTheDocument();
    expect(screen.queryByText('W-ATT0000006')).not.toBeInTheDocument();
    expect(screen.getByText(/Showing 1–5 of 7/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('W-ATT0000006')).toBeInTheDocument();
    expect(screen.getByText('W-ATT0000007')).toBeInTheDocument();
    expect(screen.queryByText('W-ATT0000001')).not.toBeInTheDocument();

    await user.selectOptions(pageSize, '10');
    expect(screen.getByText('W-ATT0000001')).toBeInTheDocument();
    expect(screen.getByText('W-ATT0000007')).toBeInTheDocument();
    expect(screen.getByText(/Showing 1–7 of 7/i)).toBeInTheDocument();
  });

  it('paginates Recent activity', async () => {
    vi.spyOn(dashboardApi, 'fetchSupervisorDashboard').mockResolvedValue({
      definitionKeys: ['I_407_WORKLOAD'],
      asOf: '2026-10-23T18:00:00.000Z',
      dimensions: [],
      appliedFilters: {},
      kpis: { loggedToday: 1, openBacklog: 1, pastSla: 0 },
      stages: [],
      pressure: [],
      assignees: [],
      actionQueue: [],
      recentActivity: Array.from({ length: 7 }, (_, index) => ({
        eventId: `e${index + 1}`,
        eventType: 'WORKLOAD_ASSIGNED',
        occurredAt: '2026-10-23T17:00:00.000Z',
        actorId: 'supervisor@example.gov',
        actorName: 'Supervisor',
        entityType: 'WORKLOAD',
        entityTrackingId: `W-ACT${String(index + 1).padStart(7, '0')}`,
        definitionKey: 'I_407_WORKLOAD',
        stageKey: 'DATA_ENTRY',
        summary: `Activity ${index + 1}`
      }))
    });

    const user = userEvent.setup();
    render(
      <FeatureFlagsProvider>
        <SupervisorWorkspace />
      </FeatureFlagsProvider>
    );
    const combobox = await screen.findByRole('combobox', { name: 'Workload Type' });
    await user.click(combobox);
    await user.click(await screen.findByRole('option', { name: /I-407/i }));
    await waitFor(() => expect(dashboardApi.fetchSupervisorDashboard).toHaveBeenCalled());

    const pageSize = screen.getByRole('combobox', { name: 'Recent activity rows per page' });
    await user.selectOptions(pageSize, '5');

    expect(screen.getByText('Activity 1')).toBeInTheDocument();
    expect(screen.getByText('Activity 5')).toBeInTheDocument();
    expect(screen.queryByText('Activity 6')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('Activity 6')).toBeInTheDocument();
    expect(screen.getByText('Activity 7')).toBeInTheDocument();
    expect(screen.queryByText('Activity 1')).not.toBeInTheDocument();
  });

  it('lists open cases when an assignee is clicked', async () => {
    const user = userEvent.setup();
    render(
      <FeatureFlagsProvider>
        <SupervisorWorkspace />
      </FeatureFlagsProvider>
    );
    const combobox = await screen.findByRole('combobox', { name: 'Workload Type' });
    await user.click(combobox);
    await user.click(await screen.findByRole('option', { name: /I-407/i }));
    await waitFor(() => expect(dashboardApi.fetchSupervisorDashboard).toHaveBeenCalled());

    const assigneeSection = screen.getByRole('heading', { name: 'By assignee' }).closest('section');
    await user.click(
      within(assigneeSection as HTMLElement).getByRole('button', { name: /officer\.a@example\.gov/i })
    );

    expect(screen.getByRole('heading', { name: 'Assigned to officer.a@example.gov' })).toBeInTheDocument();
    expect(screen.getByText('W-ASSIGNED01')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Clear filter/i })).toBeInTheDocument();
  });

  it('paginates assignee cases', async () => {
    vi.spyOn(dashboardApi, 'fetchSupervisorDashboard').mockResolvedValue({
      definitionKeys: ['I_407_WORKLOAD'],
      asOf: '2026-10-23T18:00:00.000Z',
      dimensions: [],
      appliedFilters: {},
      kpis: { loggedToday: 1, openBacklog: 8, pastSla: 0 },
      stages: [],
      pressure: [],
      assignees: [
        {
          assignedTo: 'officer.a@example.gov',
          label: 'officer.a@example.gov',
          count: 7,
          lateCount: 0,
          oldestAgeMinutes: 120,
          cases: Array.from({ length: 7 }, (_, index) => ({
            trackingId: `W-ASG${String(index + 1).padStart(7, '0')}`,
            entityType: 'WORKLOAD',
            definitionKey: 'I_407_WORKLOAD',
            stageKey: 'DATA_ENTRY',
            stageDisplayName: 'Data entry',
            assignedTo: 'officer.a@example.gov',
            ageMinutes: 120 - index,
            pastSla: false
          }))
        }
      ],
      actionQueue: [],
      recentActivity: []
    });

    const user = userEvent.setup();
    render(
      <FeatureFlagsProvider>
        <SupervisorWorkspace />
      </FeatureFlagsProvider>
    );
    const combobox = await screen.findByRole('combobox', { name: 'Workload Type' });
    await user.click(combobox);
    await user.click(await screen.findByRole('option', { name: /I-407/i }));
    await waitFor(() => expect(dashboardApi.fetchSupervisorDashboard).toHaveBeenCalled());

    const assigneeSection = screen.getByRole('heading', { name: 'By assignee' }).closest('section');
    await user.click(
      within(assigneeSection as HTMLElement).getByRole('button', { name: /officer\.a@example\.gov/i })
    );

    const pageSize = screen.getByRole('combobox', { name: 'Assignee cases rows per page' });
    await user.selectOptions(pageSize, '5');
    expect(screen.getByText('W-ASG0000001')).toBeInTheDocument();
    expect(screen.getByText('W-ASG0000005')).toBeInTheDocument();
    expect(screen.queryByText('W-ASG0000006')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('W-ASG0000006')).toBeInTheDocument();
    expect(screen.getByText('W-ASG0000007')).toBeInTheDocument();
    expect(screen.queryByText('W-ASG0000001')).not.toBeInTheDocument();
  });
});
